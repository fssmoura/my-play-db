// A full-screen look at one image, opened from the Customize drawer's
// Preview. Behaviour only; the look is in css/customize.css.
//
//   createViewer({ closeCircle }) -> { element, open(src, label, opts),
//     close(), isOpen, destroy }
//
// closeCircle is a glass circle from menu.js's builder ({ circle, button }).
// It sits in a fixed box of its own above the image (liquidGL draws a lens's
// glass under its fixed box's contents), and its lens photographs only the
// viewer, re-taken as the image zooms and moves - a few times a second while
// it moves, then once it settles.
//
// - Zoom with the wheel or a pinch, towards the pointer; double-click or
//   double-tap zooms in there (or back out); + / - / 0 on the keyboard.
// - Drag to move around once zoomed; the image never leaves the screen.
// - Close with the X, Escape, or a tap beside the image while not zoomed.

import { refreshGlassOf } from "/js/glass-refresh.js";

const MIN = 1;
const MAX = 8;
const STEP_ZOOM = 2.5;
const TAP_MS = 300;
const SLOP = 4;

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const LIVE_GAP_MS = 150;
const SETTLE_MS = 120;

export function createViewer({ closeCircle }) {
  const element = document.createElement("div");
  element.className = "customize-viewer";
  element.hidden = true;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  const img = document.createElement("img");
  img.className = "customize-viewer-img";
  img.alt = "";
  img.draggable = false;
  const close = closeCircle.button;
  const bar = document.createElement("div");
  bar.className = "customize-viewer-bar";
  bar.append(closeCircle.circle);
  element.append(img, bar);

  // The glass re-photographs the image while it moves (rate-limited) and
  // once more when it stops.
  let liveTimer = 0;
  let settleTimer = 0;
  let lastLive = 0;
  function refreshSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => refreshGlassOf(element), SETTLE_MS);
    if (liveTimer) return;
    const wait = Math.max(0, lastLive + LIVE_GAP_MS - performance.now());
    liveTimer = setTimeout(() => {
      liveTimer = 0;
      lastLive = performance.now();
      refreshGlassOf(element);
    }, wait);
  }

  let open = false;
  let returnFocus = null;
  let s = 1;
  let tx = 0;
  let ty = 0;
  let box = { w: 0, h: 0 };
  const pointers = new Map();
  let gesture = null;
  let lastTap = { time: 0, x: 0, y: 0 };

  // The image's size at 1x: as large as fits the screen.
  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    const fit = Math.min(W / nw, H / nh);
    box = { w: nw * fit, h: nh * fit };
    apply();
  }

  function clamp() {
    const maxX = Math.max(0, (box.w * s - window.innerWidth) / 2);
    const maxY = Math.max(0, (box.h * s - window.innerHeight) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  }

  function apply() {
    clamp();
    // Sized and placed directly rather than with a transform: liquidGL's
    // photo reads the image's box and ignores transforms, so the Close
    // glass would show the image where it was at 1x.
    const w = box.w * s;
    const h = box.h * s;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.left = `${(window.innerWidth - w) / 2 + tx}px`;
    img.style.top = `${(window.innerHeight - h) / 2 + ty}px`;
    element.classList.toggle("is-zoomed", s > 1.01);
    if (open) refreshSoon();
  }

  // Zooms to `next`, keeping the point under (x, y) where it is.
  function zoomAt(next, x, y) {
    next = Math.min(MAX, Math.max(MIN, next));
    const px = x - window.innerWidth / 2;
    const py = y - window.innerHeight / 2;
    tx = px - ((px - tx) * next) / s;
    ty = py - ((py - ty) * next) / s;
    s = next;
    apply();
  }

  function animate(fn) {
    if (reducedMotion()) return fn();
    img.classList.add("is-easing");
    fn();
    setTimeout(() => {
      img.classList.remove("is-easing");
      refreshSoon();
    }, 220);
  }

  const center = () => [window.innerWidth / 2, window.innerHeight / 2];

  function onWheel(event) {
    event.preventDefault();
    zoomAt(s * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
  }

  function onDown(event) {
    if (event.target.closest(".customize-viewer-bar")) return;
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  }

  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      gesture = {
        kind: "pan",
        x: pts[0].x,
        y: pts[0].y,
        tx,
        ty,
        moved: false,
        start: performance.now(),
      };
    } else if (pts.length === 2) {
      const [a, b] = pts;
      gesture = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        s,
        moved: true,
      };
    }
  }

  function onMove(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.values()];
    if (gesture.kind === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      zoomAt((gesture.s * dist) / gesture.dist, mx, my);
      tx += mx - gesture.mx;
      ty += my - gesture.my;
      gesture.mx = mx;
      gesture.my = my;
      apply();
    } else if (gesture.kind === "pan") {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < SLOP) return;
      gesture.moved = true;
      tx = gesture.tx + dx;
      ty = gesture.ty + dy;
      apply();
    }
  }

  function onUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    const ended = gesture;
    if (pointers.size) {
      startGesture();
      return;
    }
    gesture = null;
    if (!ended || ended.moved || ended.kind !== "pan") return;
    if (performance.now() - ended.start > 500) return;
    onTap(event.clientX, event.clientY, event.target);
  }

  // Double tap zooms in at the point, or back out; a single tap beside the
  // image (not zoomed) closes.
  function onTap(x, y, target) {
    const now = performance.now();
    const double =
      now - lastTap.time < TAP_MS &&
      Math.hypot(x - lastTap.x, y - lastTap.y) < 30;
    if (double) {
      lastTap = { time: 0, x: 0, y: 0 };
      animate(() => {
        if (s > 1.01) {
          s = 1;
          tx = 0;
          ty = 0;
          apply();
        } else zoomAt(STEP_ZOOM, x, y);
      });
      return;
    }
    lastTap = { time: now, x, y };
    if (target !== img && s <= 1.01) {
      setTimeout(() => {
        if (lastTap.time === now) hide();
      }, TAP_MS);
    }
  }

  function onKey(event) {
    if (!open) return;
    const [cx, cy] = center();
    if (event.key === "+" || event.key === "=") {
      animate(() => zoomAt(s * 1.5, cx, cy));
    } else if (event.key === "-") {
      animate(() => zoomAt(s / 1.5, cx, cy));
    } else if (event.key === "0") {
      animate(() => {
        s = 1;
        tx = 0;
        ty = 0;
        apply();
      });
    } else return;
    event.preventDefault();
  }

  // Focus moves to Close only from the keyboard (no ring for mouse/touch).
  function show(src, label, { byKeyboard = false } = {}) {
    if (!src) return;
    open = true;
    // Focus only comes back to the image afterwards for a keyboard user; a
    // mouse or touch user is left with nothing focused (no stray ring).
    if (byKeyboard) returnFocus = document.activeElement;
    else {
      returnFocus = null;
      document.activeElement?.blur?.();
    }
    s = 1;
    tx = 0;
    ty = 0;
    element.setAttribute("aria-label", label);
    img.onload = layout;
    img.src = src;
    if (img.complete && img.naturalWidth) layout();
    element.hidden = false;
    requestAnimationFrame(() => element.classList.add("is-open"));
    if (byKeyboard) close.focus({ preventScroll: true });
  }

  function hide() {
    if (!open) return;
    open = false;
    pointers.clear();
    gesture = null;
    element.classList.remove("is-open");
    const done = () => {
      if (!open) element.hidden = true;
    };
    if (reducedMotion()) done();
    else setTimeout(done, 160);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else if (element.contains(document.activeElement))
      document.activeElement.blur();
    returnFocus = null;
  }

  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onUp);
  close.addEventListener("click", hide);
  document.addEventListener("keydown", onKey);
  const onResize = () => open && layout();
  window.addEventListener("resize", onResize);

  return {
    element,
    open: show,
    close: hide,
    get isOpen() {
      return open;
    },
    destroy() {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      clearTimeout(liveTimer);
      clearTimeout(settleTimer);
      element.remove();
    },
  };
}
