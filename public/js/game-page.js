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
// line under them (game-info.js), then its Trailers and Images (game-media.js);
// it shows a whole-sheet shimmer (.is-loading) while the game's art resolves.
// Closing hands focus back to the card that opened it. Dragging it down
// (touch, pen or mouse) dismisses it like Back.

import { createSpring } from "/js/spring.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import {
  blankGlass,
  glassPhotographs,
  refreshGlass,
} from "/js/glass-refresh.js";
import { resolveGameArt, isIgdb } from "/js/game-art.js";
import { loadGameRow, setGameArtArray } from "/js/games-cache.js";
import { displayImageUrl, loadImageForGlass } from "/js/image-url.js";
import { gameHeading, gameInfoLine } from "/js/game-info.js";
import { gameMediaSections, closeMediaLayers } from "/js/game-media.js";

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
  // Moves as one as it scrolls, so the glass can follow it (pointGlass).
  const track = document.createElement("div");
  track.append(spacer, sheet);
  scroller.append(track);

  layer.append(scroller);
  return { layer, sheet, scroller, body, spacer, track };
}

// Past this fraction of the sheet's visible height, or flicked faster than
// FLICK px/ms, a release closes it.
const CLOSE_FRACTION = 0.25;
const FLICK = 0.5;
const SLOP = 8;
// The sheet's resting top, px from the viewport top (css: .game-spacer).
const REST_TOP = 85;

// A dark version of the banner's main colour, for the fade under it and the
// top of the page (the way streaming apps tint their backgrounds). Reads the
// lower half (what fades out), favouring colourful pixels over grey ones.
// Null when the image can't be read (no CORS), leaving plain black.
function bannerTint(img) {
  try {
    const w = 24;
    const h = 12;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sh = img.naturalHeight / 2;
    ctx.drawImage(img, 0, sh, img.naturalWidth, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    let chroma = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const weight = 0.15 + (max - min) / 255;
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
      total += weight;
      chroma += (max - min) / 255;
    }
    if (!total) return null;
    const [hue, sat] = toHsl(r / total, g / total, b / total);
    // Mostly white, grey or cream art fades to a near-neutral dark grey
    // rather than a strong tint of its faint hue.
    const vivid = Math.min(chroma / (data.length / 4) / 0.25, 1);
    const s = Math.min(sat, 0.45) * vivid;
    return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% 11%)`;
  } catch {
    return null;
  }
}

// The banner art heavily blurred and darkened, as a small image the page
// stretches (see .game-sheet-body::before) to twice the banner's height: the
// banner as it shows (cropped like object-fit: cover) on top, and a mirror of
// it below, so the picture seems to carry on down the page. The blur is a few downscale
// steps, each softened by the browser's smoothing, then a box blur on the
// tiny copy. Null when the image can't be read (no CORS).
function bannerGlow(img, tint) {
  try {
    const w = 32;
    const h = 36;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const half = h / 2;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(w / iw, half / ih);
    const sw = w / scale;
    const sh = half / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, half);
    ctx.save();
    ctx.translate(0, h);
    ctx.scale(1, -1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, half);
    ctx.restore();
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    let src = Float32Array.from(d);
    const r = 2;
    const pass = (dx, dy) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          for (let k = -r; k <= r; k++) {
            const xx = Math.min(Math.max(x + k * dx, 0), w - 1);
            const yy = Math.min(Math.max(y + k * dy, 0), h - 1);
            const j = (yy * w + xx) * 4;
            out[i] += src[j];
            out[i + 1] += src[j + 1];
            out[i + 2] += src[j + 2];
          }
          out[i] /= 2 * r + 1;
          out[i + 1] /= 2 * r + 1;
          out[i + 2] /= 2 * r + 1;
        }
      }
      src = out;
    };
    for (let n = 0; n < 3; n++) {
      pass(1, 0);
      pass(0, 1);
    }
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      for (let c = 0; c < 3; c++)
        d[i + c] = (l + (src[i + c] - l) * 1.3) * 0.45;
      d[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const big = document.createElement("canvas");
    big.width = w * 8;
    big.height = h * 8;
    const bctx = big.getContext("2d");
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(canvas, 0, 0, big.width, big.height);
    // Below the banner it eases into the tint, then fades out onto the tint
    // itself, so there is no step between picture and colour. Built in, so
    // every copy of it (behind the banner, under it and in the fade below it)
    // matches.
    // Both fades are arcs from the top centre (further down the middle than
    // the sides) on eased curves, so neither shows as a straight line.
    const arc = (stops, op) => {
      bctx.save();
      bctx.translate(big.width / 2, 0);
      bctx.scale((1.7 * big.width) / big.height, 1);
      const g = bctx.createRadialGradient(0, 0, 0, 0, 0, big.height);
      for (const [at, colour] of stops) g.addColorStop(at, colour);
      bctx.globalCompositeOperation = op;
      bctx.fillStyle = g;
      bctx.fillRect(-big.height, 0, big.height * 2, big.height);
      bctx.restore();
    };
    const ease = (from, to, a, b) =>
      [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1].map((t) => [
        from + (to - from) * t,
        // smoothstep
        a + (b - a) * t * t * (3 - 2 * t),
      ]);
    if (tint)
      arc(
        ease(0.28, 0.62, 0, 1).map(([at, x]) => [
          at,
          tint.replace(")", ` / ${x.toFixed(3)})`),
        ]),
        "source-atop",
      );
    const [f0, f1] = tint ? [0.56, 0.8] : [0.36, 0.66];
    arc(
      ease(f0, f1, 1, 0).map(([at, x]) => [
        at,
        `rgba(0, 0, 0, ${x.toFixed(3)})`,
      ]),
      "destination-in",
    );
    return big.toDataURL("image/png");
  } catch {
    return null;
  }
}

function toHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

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
      pointGlass(false);
      blankGlass();
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
    closeMediaLayers();
    parts?.body.querySelector(".game-head")?.remove();
    parts?.body.querySelector(".game-info")?.remove();
    parts?.body.querySelector(".game-media")?.remove();
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
    parts.body.style.removeProperty("--tint");
    parts.body.style.removeProperty("--banner-glow");
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
    placeMedia(run);
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
          if (cls === "game-banner") {
            const tint = bannerTint(img);
            if (tint) parts.body.style.setProperty("--tint", tint);
            const glow = bannerGlow(img, tint);
            if (glow)
              parts.body.style.setProperty("--banner-glow", `url(${glow})`);
            placeGlow();
          }
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

  // Trailers and Images, last in the body. Their pictures arrive after the
  // page has settled, so each one asks the lenses to retake their picture
  // (once things go quiet).
  let mediaTimer = 0;
  function placeMedia(run) {
    if (!parts || !shown) return;
    const { id } = shown;
    const media = gameMediaSections(shown.row, {
      behind: parts.layer,
      onImageLoad: () => {
        clearTimeout(mediaTimer);
        mediaTimer = setTimeout(() => run === artRun && refreshGlass(), 300);
      },
      onSetAs: (kind, url) => setArt(id, kind, url),
    });
    if (media) parts.body.append(media);
  }

  // The viewer's "Set as": the picture goes first with one other image kept
  // behind it, as when it is picked in Customize; then the page redraws.
  async function setArt(id, kind, url) {
    const now = (await loadGameRow(id))?.[kind] ?? [];
    const rest = now.filter((x) => x !== url);
    const backup = isIgdb(url) ? rest[0] : (rest.find(isIgdb) ?? rest[0]);
    await setGameArtArray(id, kind, backup ? [url, backup] : [url]);
    game.reportArtChanged(id);
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

  // Reports scrolling to the toolbar, and moves what follows the scroll.
  let lastTop = 0;
  let lastOverlap = 0;
  let lastFlat = false;
  let lastUnder = 0;
  function onScroll() {
    const top = parts.scroller.scrollTop;
    game.reportScroll({ top, delta: top - lastTop });
    lastTop = top;
    placeGlow();
    // The sheet's top meets the name's bottom (25 + 44px) at 16px scrolled;
    // its shadow fades in over the next 16px.
    const overlap = Math.min(Math.max((top - 16) / 16, 0), 1);
    if (overlap !== lastOverlap) {
      lastOverlap = overlap;
      parts.sheet.style.setProperty("--overlap", overlap.toFixed(3));
    }
    // Its rounded top corners square off the moment it reaches the top of
    // the screen (REST_TOP), and round again as soon as it leaves.
    const flat = top >= REST_TOP;
    if (flat !== lastFlat) {
      lastFlat = flat;
      parts.sheet.classList.toggle("is-flat", flat);
    }
    // Content starts passing under the pinned banner once the sheet has risen
    // (REST_TOP); the fade under the logo grows over the next 60px. It starts
    // 44px early because the content sits that much closer to the logo than
    // the fade was tuned for, so it still fades at the same place on screen.
    const under = Math.min(Math.max((top - REST_TOP + 44) / 60, 0), 1);
    if (under !== lastUnder) {
      lastUnder = under;
      parts.sheet.style.setProperty("--under", under.toFixed(3));
    }
  }

  // The bars' glass photographs the game page once and slides that photo as
  // it scrolls, like the page's own glass does, so scrolling takes no new
  // photos. The pinned banner and the image cards (which scroll sideways)
  // move differently, so they're left out of the photo and drawn over it
  // where they are, live. The heading is pinned too, but never under a lens.
  function pointGlass(on) {
    const lens = document.getElementById("app-bottom");
    if (!on || !parts) return glassPhotographs(lens, null);
    const { track } = parts;
    glassPhotographs(lens, track, {
      ignore: (el) =>
        el.classList?.contains("game-head") ||
        el.classList?.contains("media-card") ||
        el.classList?.contains("game-heading"),
      pieces: () => [
        ...[...track.querySelectorAll(".media-card")].map((el) => ({
          el,
          clip: el.closest(".media-row"),
        })),
        ...[...track.querySelectorAll(".game-head")].map((el) => ({ el })),
      ],
    });
  }

  // Keeps the page's blurred backdrop level with the pinned banner's.
  function placeGlow() {
    const banner = parts?.body.querySelector(".game-banner");
    if (!banner) return;
    const y =
      banner.getBoundingClientRect().top -
      parts.body.getBoundingClientRect().top;
    parts.body.style.setProperty("--glow-y", `${y}px`);
    parts.body.style.setProperty("--glow-h", `${banner.offsetHeight * 2}px`);
  }

  // The scroll indicator starts below the banner and the black under its logo
  // (where the scrolling content shows), or just under the top bar when there
  // is none.
  const TRACK_TOP = 24;
  function trackTop() {
    const banner = parts?.body.querySelector(".game-banner");
    if (!banner) return TRACK_TOP;
    const logo = parts.body.querySelector(".game-head .game-logo");
    const hang = logo ? Math.max(0, logo.offsetHeight / 2 - 8) : 0;
    const sheetTop = Math.max(0, REST_TOP - parts.scroller.scrollTop);
    return Math.max(TRACK_TOP, sheetTop + banner.offsetHeight + hang + 6);
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
      lastOverlap = 0;
      lastUnder = 0;
      parts.scroller.addEventListener("scroll", onScroll, { passive: true });
      document.documentElement.classList.add("is-game-open");
      freezeContent();
      pointGlass(true);
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
    closeMediaLayers();
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
  // downward, so it never fights scrolling (a mostly sideways move is left to
  // the Trailers and Images rows). Pointer events cover mouse and
  // pen; touch needs touch events, because only a cancelled touchmove stops the
  // browser taking the gesture over as a pan (which cancels the pointer).
  let unwireDrag = null;

  function wireDrag({ layer: sheet, scroller }) {
    let start = null; // { x, y, id } while a press might become a drag
    let dragging = false;
    let samples = []; // [time, y] of the last few moves, for the flick speed

    const height = () => Math.max(1, window.innerHeight - REST_TOP);
    const reset = () => {
      start = null;
      dragging = false;
      samples = [];
    };

    function press(x, y, id) {
      if (game.isOpen && scroller.scrollTop <= 0) {
        start = { x, y, id };
        samples = [[performance.now(), y]];
      }
    }

    // Returns true when it took the gesture.
    function move(x, y) {
      if (!start) return false;
      const dy = y - start.y;
      if (!dragging) {
        const dx = Math.abs(x - start.x);
        if (dy < -SLOP || (dx > SLOP && dx > Math.abs(dy))) start = null;
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
      press(e.clientX, e.clientY, e.pointerId);
    };
    const onPointerMove = (e) => {
      if (e.pointerType === "touch" || start?.id !== e.pointerId) return;
      if (move(e.clientX, e.clientY) && !sheet.hasPointerCapture(e.pointerId))
        sheet.setPointerCapture(e.pointerId);
    };
    const onPointerUp = (e) => {
      if (e.pointerType === "touch" || start?.id !== e.pointerId) return;
      release(e.clientY, e.type === "pointercancel");
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 1)
        press(e.touches[0].clientX, e.touches[0].clientY, "touch");
      else if (dragging) release(e.touches[0].clientY, true);
      else reset();
    };
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (start?.id === "touch" && move(t.clientX, t.clientY) && e.cancelable)
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
  window.addEventListener("resize", placeGlow);

  return {
    destroy() {
      offOpen();
      offClose();
      offArt();
      offLibrary?.();
      window.removeEventListener("resize", fitHeading);
      window.removeEventListener("resize", placeGlow);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      closeMediaLayers();
      spring.destroy();
      overlay?.destroy();
      pointGlass(false);
      parts?.layer.remove();
      parts = null;
      unfreezeContent();
      content.inert = false;
      document.documentElement.classList.remove("is-game-open");
    },
  };
}
