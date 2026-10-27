// The game page: a sheet that slides up from the bottom over the search
// results. Behaviour only - the look lives in css/game-page.css, and the one
// number that animates it is --game-t (0 hidden, 1 open) on the layer.
//
//   createGamePage({ game, content })
//
// - game: the game state (game-state.js). The sheet opens and closes in
//   response to its "open" / "close" events; nothing here touches the address
//   or the top bar.
// - content: the page behind (#app-content). It stays mounted and keeps its
//   scroll position, but is made inert while the sheet is open.
// - onProgress(t): called with the sheet's progress (0 hidden, 1 open) on every
//   frame, including while a finger drags it, so the page behind can fade in
//   step (pages.js `setCovered`).
//
// The sheet is empty for now. Closing hands focus back to the card that opened
// it. Dragging it down (touch, pen or mouse) dismisses it like Back.

import { createSpring } from "/js/spring.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import { refreshGlass } from "/js/glass-refresh.js";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildLayer() {
  const layer = document.createElement("div");
  layer.className = "game-layer";

  const sheet = document.createElement("section");
  sheet.className = "game-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Game");
  sheet.tabIndex = -1;

  const scroller = document.createElement("div");
  scroller.className = "game-sheet-scroll overlay-scroll-host";
  const body = document.createElement("div");
  body.className = "game-sheet-body";
  scroller.append(body);
  sheet.append(scroller);

  layer.append(sheet);
  return { layer, sheet, scroller, body };
}

// Past this fraction of the sheet's visible height, or flicked faster than
// FLICK px/ms, a release closes it.
const CLOSE_FRACTION = 0.25;
const FLICK = 0.5;
const SLOP = 8;

export function createGamePage({ game, content, onProgress }) {
  let parts = null;
  let overlay = null;
  let opener = null;

  const spring = createSpring({
    onUpdate: (v) => {
      parts?.layer.style.setProperty("--game-t", v.toFixed(4));
      onProgress?.(v);
    },
    onRest: (target) => {
      if (target === 1) {
        refreshGlass();
        return;
      }
      // Fully closed: remove the sheet and let the page scroll again.
      overlay?.destroy();
      overlay = null;
      parts?.layer.remove();
      parts = null;
      unwireDrag = null;
      document.documentElement.classList.remove("is-game-open");
      refreshGlass();
    },
  });

  function onOpen() {
    // Rapid close then open: the sheet is still there, just reverse it.
    if (!parts) {
      // The card that opened it, for focus on the way back (none when the
      // page was loaded straight onto a game).
      opener = content.contains(document.activeElement)
        ? document.activeElement
        : null;
      parts = buildLayer();
      document.body.append(parts.layer);
      overlay = createOverlayScroll({
        scroller: parts.scroller,
        content: parts.body,
        host: parts.sheet,
        top: 24,
        bottom: 12,
      });
      document.documentElement.classList.add("is-game-open");
      wireDrag(parts);
    }
    parts.layer.classList.remove("is-closing");
    parts.layer.inert = false;
    content.inert = true;
    parts.sheet.focus({ preventScroll: true });
    spring.to(1, { instant: reducedMotion() });
  }

  function onClose({ id }) {
    if (!parts) return;
    unwireDrag?.();
    parts.layer.classList.add("is-closing");
    parts.layer.inert = true;
    content.inert = false;
    // The grid keeps its nodes while covered, so the card is still there.
    const card = opener?.isConnected
      ? opener
      : content.querySelector(`.result-card[data-id="${id}"] .result-open`);
    opener = null;
    card?.focus({ preventScroll: true });
    spring.to(0, { instant: reducedMotion() });
  }

  // ---- swipe down to dismiss ----------------------------------------------
  // Starts only when the sheet's scroll is at the top and the movement is
  // downward, so it never fights scrolling. Pointer events cover mouse and
  // pen; touch needs touch events, because only a cancelled touchmove stops the
  // browser taking the gesture over as a pan (which cancels the pointer).
  let unwireDrag = null;

  function wireDrag({ sheet, scroller }) {
    let start = null; // { y, id } while a press might become a drag
    let dragging = false;
    let samples = []; // [time, y] of the last few moves, for the flick speed

    const height = () => Math.max(1, window.innerHeight - sheet.offsetTop);
    const reset = () => {
      start = null;
      dragging = false;
      samples = [];
    };

    function press(y, id) {
      if (game.isOpen && scroller.scrollTop <= 0) {
        start = { y, id };
        samples = [[performance.now(), y]];
      }
    }

    // Returns true when it took the gesture.
    function move(y) {
      if (!start) return false;
      const dy = y - start.y;
      if (!dragging) {
        if (dy < -SLOP) start = null;
        if (!start || dy < SLOP || scroller.scrollTop > 0) return false;
        dragging = true;
        sheet.classList.add("is-dragging");
      }
      samples.push([performance.now(), y]);
      if (samples.length > 6) samples.shift();
      // Pulling up past open isn't allowed.
      spring.set(1 - Math.max(0, dy) / window.innerHeight);
      return true;
    }

    function release(y, cancelled) {
      if (!start) return;
      const wasDragging = dragging;
      const dy = Math.max(0, y - start.y);
      // Speed over the last ~100ms of movement (a pause before letting go
      // means it is not a flick).
      const now = performance.now();
      const recent = samples.filter(([t]) => now - t <= 100);
      const [t0, y0] = recent[0] ?? [now, y];
      const dt = now - t0;
      const speed = dt > 0 ? (y - y0) / dt : 0;
      reset();
      if (!wasDragging) return;
      sheet.classList.remove("is-dragging");
      const fast = speed > FLICK;
      if (!cancelled && (fast || dy > CLOSE_FRACTION * height())) {
        game.close("swipe");
      } else {
        spring.to(1, { instant: reducedMotion() });
      }
    }

    const onPointerDown = (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      press(e.clientY, e.pointerId);
    };
    const onPointerMove = (e) => {
      if (e.pointerType === "touch" || start?.id !== e.pointerId) return;
      if (move(e.clientY) && !sheet.hasPointerCapture(e.pointerId))
        sheet.setPointerCapture(e.pointerId);
    };
    const onPointerUp = (e) => {
      if (e.pointerType === "touch" || start?.id !== e.pointerId) return;
      release(e.clientY, e.type === "pointercancel");
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 1) press(e.touches[0].clientY, "touch");
      else if (dragging) release(e.touches[0].clientY, true);
      else reset();
    };
    const onTouchMove = (e) => {
      if (start?.id === "touch" && move(e.touches[0].clientY) && e.cancelable)
        e.preventDefault();
    };
    const onTouchEnd = (e) => {
      if (start?.id !== "touch") return;
      const t = e.changedTouches[0];
      release(t.clientY, e.type === "touchcancel");
    };

    const opts = { passive: false };
    sheet.addEventListener("pointerdown", onPointerDown);
    sheet.addEventListener("pointermove", onPointerMove);
    sheet.addEventListener("pointerup", onPointerUp);
    sheet.addEventListener("pointercancel", onPointerUp);
    sheet.addEventListener("touchstart", onTouchStart, opts);
    sheet.addEventListener("touchmove", onTouchMove, opts);
    sheet.addEventListener("touchend", onTouchEnd);
    sheet.addEventListener("touchcancel", onTouchEnd);
    unwireDrag = () => {
      // Listeners go with the element; just make sure nothing is left mid-drag.
      sheet.classList.remove("is-dragging");
      reset();
    };
  }

  const offOpen = game.on("open", onOpen);
  const offClose = game.on("close", onClose);

  return {
    destroy() {
      offOpen();
      offClose();
      spring.destroy();
      overlay?.destroy();
      parts?.layer.remove();
      parts = null;
      content.inert = false;
      document.documentElement.classList.remove("is-game-open");
    },
  };
}
