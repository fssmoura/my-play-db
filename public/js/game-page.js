// The game page: a sheet that slides up from the bottom over the search
// results. Behaviour only - the look lives in css/game-page.css, and the one
// number that animates it is --game-t (0 hidden, 1 open) on the layer.
//
//   createGamePage({ game, content, library })
//
// - game: the game state (game-state.js). The sheet opens and closes in
//   response to its "open" / "close" events; nothing here touches the address
//   or the top bar.
// - content: the page behind (#app-content). It stays mounted and keeps its
//   scroll position, but is made inert while the sheet is open.
// - library: the owner's library (library.js), for which platforms and stores
//   the platform marks show as owned.
// - onProgress(t): called with the sheet's progress (0 hidden, 1 open) on every
//   frame, including while a finger drags it, so the page behind can fade in
//   step (pages.js `setCovered`).
//
// The sheet holds the game's banner and logo, when it has them, and the info
// line under them (game-info.js); it shows a
// whole-sheet shimmer (.is-loading) while the game's art resolves. Closing hands focus back to the card that opened
// it. Dragging it down (touch, pen or mouse) dismisses it like Back.

import { createSpring } from "/js/spring.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import {
  blankGlass,
  refreshGlass,
  refreshGlassWhileScrolling,
} from "/js/glass-refresh.js";
import { resolveGameArt } from "/js/game-art.js";
import { displayImageUrl, loadImageForGlass } from "/js/image-url.js";
import { gameHeading, gameInfoLine } from "/js/game-info.js";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildLayer() {
  const layer = document.createElement("div");
  layer.className = "game-layer";

  // The layer slides in; inside it one scroller holds an 85px spacer and the
  // sheet, so scrolling first lifts the sheet to the top of the viewport and
  // then scrolls its content (one continuous scroll, one indicator).
  const scroller = document.createElement("div");
  scroller.className = "game-scroll overlay-scroll-host";
  const spacer = document.createElement("div");
  spacer.className = "game-spacer";

  const sheet = document.createElement("section");
  sheet.className = "game-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Game");
  sheet.tabIndex = -1;

  const body = document.createElement("div");
  body.className = "game-sheet-body";
  // Sheet-level loading shimmer (shown while the sheet has is-loading).
  const skeleton = document.createElement("div");
  skeleton.className = "game-skeleton";
  skeleton.setAttribute("aria-hidden", "true");
  sheet.classList.add("is-loading");
  sheet.append(body, skeleton);
  scroller.append(spacer, sheet);

  layer.append(scroller);
  return { layer, sheet, scroller, body, spacer };
}

// Past this fraction of the sheet's visible height, or flicked faster than
// FLICK px/ms, a release closes it.
const CLOSE_FRACTION = 0.25;
const FLICK = 0.5;
const SLOP = 8;
// The sheet's resting top, px from the viewport top (css: .game-spacer).
const REST_TOP = 85;

export function createGamePage({ game, content, library, onProgress }) {
  let parts = null;
  let overlay = null;
  let opener = null;

  // While the sheet is up, the page behind is pinned where it was and kept
  // out of the glass's photos. Every photo used to redraw the whole results
  // list (hidden, but still the longest thing on the page), which made each
  // one slow on a phone; now the photos are of the sheet alone, and the glass
  // drops the list's reflections the moment the sheet starts to open.
  let frozenAt = null;
  function freezeContent() {
    if (frozenAt !== null) return;
    frozenAt = window.scrollY;
    content.style.top = `${-frozenAt}px`;
    content.classList.add("is-frozen");
    content.setAttribute("data-liquid-ignore", "");
    blankGlass();
  }
  function unfreezeContent() {
    if (frozenAt === null) return;
    content.classList.remove("is-frozen");
    content.style.top = "";
    content.removeAttribute("data-liquid-ignore");
    window.scrollTo(0, frozenAt);
    frozenAt = null;
  }

  // Whether the last thing the person did was a tap or click (rather than a
  // key). Focus handed back to the card after one is kept quiet: on a phone it
  // otherwise counts as keyboard focus and leaves the card highlighted.
  let pointerLast = false;
  const onPointerDown = () => (pointerLast = true);
  const onKeyDown = () => (pointerLast = false);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  function quietFocus(button) {
    button.dataset.quietFocus = "";
    button.addEventListener("blur", () => delete button.dataset.quietFocus, {
      once: true,
    });
  }

  const spring = createSpring({
    onUpdate: (v) => {
      parts?.layer.style.setProperty("--game-t", v.toFixed(4));
      onProgress?.(v);
      game.reportProgress(v);
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
      unfreezeContent();
      document.documentElement.classList.remove("is-game-open");
      refreshGlass();
    },
  });

  // Art for the open game. The whole sheet shows a loading state (is-loading)
  // while its art resolves (game-art.js: row read, IGDB detail pull,
  // SteamGridDB lookup). Once we know which images exist the header is laid
  // out and the shimmer ends straight away - the page never waits on a
  // download. The banner box holds its shape and each image fades in when it
  // arrives; a failed one removes its box. An answer for a game that is no
  // longer the open one is dropped (it touches no UI state).
  let artRun = 0;
  // The open game's row, for redrawing its platform marks.
  let shown = null;
  function setLoading(on) {
    parts?.sheet.classList.toggle("is-loading", on);
    game.reportLoading(on);
  }
  async function loadArt(id) {
    const run = ++artRun;
    shown = null;
    parts?.body.querySelector(".game-head")?.remove();
    parts?.body.querySelector(".game-info")?.remove();
    parts?.spacer.querySelector(".game-heading")?.remove();
    parts?.body.style.removeProperty("--logo-ratio");
    setLoading(true);
    let banner = null;
    let logo = null;
    let row = null;
    try {
      ({ banner, logo, game: row } = await resolveGameArt(id));
    } catch {
      // resolveGameArt does not throw; stay defensive so loading always ends.
    }
    if (run !== artRun || !parts) return;
    // The heading sits in the spacer, between Back and the menu pill, so the
    // rising sheet scrolls it away.
    const heading = gameHeading(row);
    if (heading) {
      fitHeading();
      parts.spacer.append(heading);
    }
    // The platform marks go under the header (or at the top when there is
    // none) and scroll with the content rather than pinning.
    shown = row ? { id, row } : null;
    placeInfo();
    const bannerUrl = banner ? displayImageUrl(banner, "banner") : null;
    const logoUrl = logo ? displayImageUrl(logo, "logo") : null;
    if (!bannerUrl && !logoUrl) return finishLoading(run);

    // The sticky header: the banner and the logo pin together. The header is
    // dropped if both images fail.
    const head = document.createElement("div");
    head.className = "game-head";
    head.classList.toggle("has-banner", !!bannerUrl);
    parts.body.prepend(head);

    // After an image fades in (or its box goes), the lenses retake their
    // picture.
    const settle = () => {
      if (run !== artRun || !parts) return;
      overlay?.update();
      setTimeout(
        () => run === artRun && refreshGlass(),
        reducedMotion() ? 0 : 300,
      );
    };

    const addImage = (cls, url) => {
      const box = document.createElement("div");
      box.className = cls;
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      // A drag here is the sheet's swipe-down, not an image drag.
      img.draggable = false;
      loadImageForGlass(img, url, {
        onLoad: () => {
          if (run !== artRun) return;
          if (cls === "game-logo" && img.naturalWidth && img.naturalHeight) {
            // On the body, so the info line below can follow the logo's height.
            parts.body.style.setProperty(
              "--logo-ratio",
              String(img.naturalWidth / img.naturalHeight),
            );
          }
          box.classList.add("is-loaded");
          settle();
        },
        onError: () => {
          if (run !== artRun) return;
          box.remove();
          head.classList.toggle(
            "has-banner",
            !!head.querySelector(".game-banner"),
          );
          if (!head.children.length) head.remove();
          settle();
        },
      });
      box.append(img);
      if (cls === "game-banner") head.prepend(box);
      else head.append(box);
    };

    if (bannerUrl) addImage("game-banner", bannerUrl);
    if (logoUrl) addImage("game-logo", logoUrl);
    overlay?.update();
    finishLoading(run);
  }

  // The platform marks, redrawn in place (after the header, if any).
  function placeInfo() {
    if (!parts) return;
    parts.body.querySelector(".game-info")?.remove();
    if (!shown) return;
    const info = gameInfoLine(shown.row, library?.copies(shown.id) ?? []);
    if (!info) return;
    const head = parts.body.querySelector(".game-head");
    if (head) head.after(info);
    else parts.body.prepend(info);
  }

  // The heading ends 12px short of the menu pill, whose width follows its
  // button count, so it is measured (on open and on resize).
  function fitHeading() {
    const pill = document.querySelector(".menu-bar > :last-child");
    if (!pill || !parts) return;
    const gap = window.innerWidth - pill.getBoundingClientRect().left + 12;
    parts.spacer.style.setProperty("--heading-right", `${Math.round(gap)}px`);
  }

  // Waits for the fade to finish before the lenses retake their picture.
  function finishLoading(run) {
    if (run !== artRun || !parts) return;
    setLoading(false);
    overlay?.update();
    setTimeout(
      () => run === artRun && refreshGlass(),
      reducedMotion() ? 0 : 350,
    );
  }

  // Reports scrolling to the toolbar, and keeps the glass current: the lenses
  // photograph the page, and an inner scroller is not something they track.
  let lastTop = 0;
  function onScroll() {
    const top = parts.scroller.scrollTop;
    game.reportScroll({ top, delta: top - lastTop });
    lastTop = top;
    // Only the rise changes what is under the top bar's lenses; past it the
    // pinned banner (or nothing) is there. See glass-refresh.js for the cost.
    refreshGlassWhileScrolling({ live: top <= REST_TOP });
  }

  // The scroll indicator starts below the banner (where the scrolling content
  // is), or just under the top bar when there is none.
  const TRACK_TOP = 24;
  function trackTop() {
    const banner = parts?.body.querySelector(".game-banner");
    if (!banner) return TRACK_TOP;
    const sheetTop = Math.max(0, REST_TOP - parts.scroller.scrollTop);
    return Math.max(TRACK_TOP, sheetTop + banner.offsetHeight + 6);
  }

  function onOpen({ id }) {
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
        host: parts.layer,
        top: trackTop,
        bottom: 12,
      });
      lastTop = 0;
      parts.scroller.addEventListener("scroll", onScroll, { passive: true });
      document.documentElement.classList.add("is-game-open");
      freezeContent();
      wireDrag(parts);
    }
    parts.layer.classList.remove("is-closing");
    parts.layer.inert = false;
    content.inert = true;
    parts.sheet.focus({ preventScroll: true });
    loadArt(id);
    spring.to(1, { instant: reducedMotion() });
  }

  function onClose({ id }) {
    if (!parts) return;
    artRun++;
    unwireDrag?.();
    parts.layer.classList.add("is-closing");
    parts.layer.inert = true;
    content.inert = false;
    // The grid keeps its nodes while covered, so the card is still there.
    const card = opener?.isConnected
      ? opener
      : content.querySelector(`.result-card[data-id="${id}"] .result-open`);
    opener = null;
    if (card && pointerLast) quietFocus(card);
    card?.focus({ preventScroll: true });
    spring.to(0, { instant: reducedMotion() });
  }

  // ---- swipe down to dismiss ----------------------------------------------
  // Starts only when the sheet's scroll is at the top and the movement is
  // downward, so it never fights scrolling. Pointer events cover mouse and
  // pen; touch needs touch events, because only a cancelled touchmove stops the
  // browser taking the gesture over as a pan (which cancels the pointer).
  let unwireDrag = null;

  function wireDrag({ layer: sheet, scroller }) {
    let start = null; // { y, id } while a press might become a drag
    let dragging = false;
    let samples = []; // [time, y] of the last few moves, for the flick speed

    const height = () => Math.max(1, window.innerHeight - REST_TOP);
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
  const offArt = game.on("art", ({ id }) => {
    if (parts && id === game.id) loadArt(id);
  });
  // The library may arrive after the page opened: the marks then show what is owned.
  const offLibrary = library?.on("change", placeInfo);
  window.addEventListener("resize", fitHeading);

  return {
    destroy() {
      offOpen();
      offClose();
      offArt();
      offLibrary?.();
      window.removeEventListener("resize", fitHeading);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      spring.destroy();
      overlay?.destroy();
      parts?.layer.remove();
      parts = null;
      unfreezeContent();
      content.inert = false;
      document.documentElement.classList.remove("is-game-open");
    },
  };
}
