// The game page's Trailers and Images sections (css/game-media.css): a title
// that opens every card full screen, over a sideways-scrolling row of cards.
// A section is only drawn when the game has something to put in it. A card
// opens the full-screen viewer (media-viewer.js) on that item.
//
//   gameMediaSections(row, { behind, onImageLoad, onSetAs }) -> element or null
//
// - row: the game's row (videos, screenshots, artworks).
// - behind: the game page's layer, made inert under the full-screen layers.
// - onImageLoad(): a card's picture arrived (the glass retakes its photo).
// - onSetAs(kind, url): stores a picture as the game's cover, logo or banner
//   (the viewer's "Set as" menu). Returns a promise; rejects on failure.
//
// closeMediaLayers() closes whatever of the viewer and the all-cards page is
// up (the game page calls it when the game closes or changes).

import { displayImageUrl, loadImageForGlass } from "/js/image-url.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import { youTubeId, youTubeStills } from "/js/youtube-player.js";
import {
  openMediaViewer,
  closeMediaViewer,
  isMediaViewerOpen,
} from "/js/media-viewer.js";

const NS = "http://www.w3.org/2000/svg";
const CHEVRON = '<path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/>';
const PLAY =
  '<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/>';
const CLOSE =
  '<path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.29 6.3 1.42-1.42-6.3-6.29 6.3-6.3z"/>';

function icon(markup, cls) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("class", cls);
  svg.innerHTML = markup;
  return svg;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// The two sections' contents, in order. Trailers carry a YouTube id, newest
// first (IGDB lists them as they were added); pictures a card-sized and a
// full-screen address.
function sectionsFor(row) {
  const trailers = (Array.isArray(row?.videos) ? row.videos : [])
    .map((v) => ({ title: v?.name || "Trailer", videoId: youTubeId(v?.url) }))
    .filter((v) => v.videoId)
    .reverse();
  const pictures = (list, title) =>
    (Array.isArray(list) ? list : []).filter(Boolean).map((url) => ({
      title,
      url,
      thumb: displayImageUrl(url, "shot"),
      image: displayImageUrl(url, "full"),
    }));
  const images = [
    ...pictures(row?.screenshots, "Screenshot"),
    ...pictures(row?.artworks, "Artwork"),
  ];
  return [
    { name: "Trailers", items: trailers },
    { name: "Images", items: images },
  ].filter((s) => s.items.length);
}

function buildCard(item, { onOpen, onImageLoad }) {
  const card = el("button", "media-card");
  card.type = "button";
  const isVideo = !!item.videoId;
  card.classList.toggle("is-video", isVideo);
  card.setAttribute(
    "aria-label",
    isVideo ? `Play ${item.title}` : `View ${item.title.toLowerCase()}`,
  );
  const thumb = el("span", "media-thumb");
  card.append(thumb);

  const sources = isVideo ? youTubeStills(item.videoId) : [item.thumb];
  const attempt = (i) => {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.draggable = false;
    loadImageForGlass(img, sources[i], {
      onLoad: () => {
        // YouTube's stand-in for a missing still is 120px wide.
        if (isVideo && img.naturalWidth <= 120 && i + 1 < sources.length) {
          img.remove();
          return attempt(i + 1);
        }
        thumb.classList.add("is-loaded");
        onImageLoad?.();
      },
      onError: () => {
        img.remove();
        if (i + 1 < sources.length) attempt(i + 1);
        // Nothing to show: stops the shimmer, leaving the plain card.
        else thumb.classList.add("is-loaded");
      },
    });
    thumb.append(img);
  };
  attempt(0);

  if (isVideo) {
    const text = el("span", "media-card-text");
    text.append(
      el("span", "media-card-title", item.title),
      icon(PLAY, "media-card-play"),
    );
    card.append(text);
  }
  card.addEventListener("click", () => onOpen(card));
  return card;
}

// ---- the all-cards page ------------------------------------------------------

let grid = null;

export function closeMediaLayers() {
  closeMediaViewer();
  grid?.close();
}

function openGrid(section, { caption, behind, opener, onSetAs }) {
  grid?.close();
  const layer = el("div", "media-grid-layer");
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", section.name);
  layer.setAttribute("data-liquid-ignore", "");
  layer.tabIndex = -1;

  const bar = el("div", "media-grid-bar");
  const closeBtn = el("button", "media-grid-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.append(icon(CLOSE, "media-grid-close-icon"));
  bar.append(closeBtn, el("h2", "media-grid-title", section.name));

  const scroller = el("div", "media-grid-scroll overlay-scroll-host");
  const cards = el("div", "media-grid");
  section.items.forEach((item, i) =>
    cards.append(
      buildCard(item, {
        onOpen: (card) =>
          openMediaViewer({
            section: section.name,
            caption,
            items: section.items,
            index: i,
            opener: card,
            behind: layer,
            onSetAs,
          }),
      }),
    ),
  );
  scroller.append(cards);
  layer.append(bar, scroller);
  document.body.append(layer);
  const indicator = createOverlayScroll({
    scroller,
    content: cards,
    host: layer,
    top: 85,
    bottom: 12,
  });

  // The viewer, when up, takes Escape first (its own listener).
  const onKey = (e) => {
    if (e.key !== "Escape" || isMediaViewerOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  window.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", () => close());

  function close() {
    if (grid?.layer !== layer) return;
    grid = null;
    window.removeEventListener("keydown", onKey, true);
    indicator.destroy();
    layer.remove();
    if (behind) behind.inert = false;
    opener?.focus({ preventScroll: true });
  }

  grid = { layer, close };
  if (behind) behind.inert = true;
  layer.focus({ preventScroll: true });
}

// ---- the sections on the game page ----------------------------------------------

function buildRow(section, { caption, behind, onImageLoad, onSetAs }) {
  const wrap = el("section", "media-section");
  const head = el("h2", "media-head");
  const headBtn = el("button", "media-head-button");
  headBtn.type = "button";
  headBtn.setAttribute("aria-label", `All ${section.name.toLowerCase()}`);
  headBtn.append(
    el("span", "media-head-text", section.name),
    icon(CHEVRON, "media-head-chevron"),
  );
  head.append(headBtn);
  headBtn.addEventListener("click", () =>
    openGrid(section, { caption, behind, opener: headBtn, onSetAs }),
  );

  const row = el("div", "media-row");
  section.items.forEach((item, i) =>
    row.append(
      buildCard(item, {
        onImageLoad,
        onOpen: (card) =>
          openMediaViewer({
            section: section.name,
            caption,
            items: section.items,
            index: i,
            opener: card,
            behind,
            onSetAs,
          }),
      }),
    ),
  );
  wireRowScrolling(row);

  wrap.append(head, row);
  return wrap;
}

// A mouse scrolls a row by dragging it (which glides on after a flick), or
// with its wheel while over it, eased rather than in steps (until the row's
// end, when the page takes over again). Fingers and trackpads scroll it
// natively.
const FRICTION = 0.95; // speed kept per 16ms of glide
const EASE = 0.8; // distance left to the wheel's target per 16ms

function wireRowScrolling(row) {
  // Kept here rather than read back: browsers round scrollLeft.
  let pos = 0;
  let target = 0;
  let velocity = 0;
  let mode = null; // "glide" after a drag, "ease" after the wheel
  let raf = 0;
  let last = 0;
  const max = () => row.scrollWidth - row.clientWidth;
  const clamp = (x) => Math.min(max(), Math.max(0, x));
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    mode = null;
  };
  const frame = (now) => {
    const steps = Math.min(48, now - last) / 16;
    last = now;
    if (mode === "ease") {
      pos += (target - pos) * (1 - EASE ** steps);
      if (Math.abs(target - pos) < 0.5) pos = target;
    } else {
      pos += velocity * steps * 16;
      velocity *= FRICTION ** steps;
      if (pos <= 0 || pos >= max()) velocity = 0;
      pos = clamp(pos);
    }
    row.scrollLeft = pos;
    const done = mode === "ease" ? pos === target : Math.abs(velocity) < 0.02;
    raf = done ? (stop(), 0) : requestAnimationFrame(frame);
  };
  const run = (m) => {
    mode = m;
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  let press = null;
  let dragged = false;
  let samples = [];
  row.addEventListener("pointerdown", (e) => {
    stop();
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    press = { x: e.clientX, left: row.scrollLeft, id: e.pointerId };
    samples = [{ x: e.clientX, t: e.timeStamp }];
    dragged = false;
  });
  row.addEventListener("pointermove", (e) => {
    if (!press || press.id !== e.pointerId) return;
    const dx = e.clientX - press.x;
    if (!dragged && Math.abs(dx) < 5) return;
    if (!dragged) {
      dragged = true;
      row.setPointerCapture(e.pointerId);
      row.classList.add("is-dragging");
    }
    samples.push({ x: e.clientX, t: e.timeStamp });
    while (samples.length > 2 && e.timeStamp - samples[0].t > 100)
      samples.shift();
    row.scrollLeft = press.left - dx;
  });
  const end = (e) => {
    if (!press) return;
    press = null;
    row.classList.remove("is-dragging");
    if (!dragged || e.type !== "pointerup") return;
    // The speed over the last moment of the drag; none if it was held still.
    const a = samples[0];
    const b = samples[samples.length - 1];
    const fresh = e.timeStamp - b.t < 50 && b.t > a.t;
    velocity = fresh ? -(b.x - a.x) / (b.t - a.t) : 0;
    if (Math.abs(velocity) < 0.1) return;
    pos = row.scrollLeft;
    run("glide");
  };
  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
  // The release after a drag is not a click on the card under it.
  row.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // One wheel gesture stays with the row: reaching its end mid-spin doesn't
  // hand the rest to the page; a fresh spin (after a short pause) does.
  let latchUntil = 0;
  row.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const easing = mode === "ease";
      const from = easing ? target : row.scrollLeft;
      const atEnd =
        (delta < 0 && from <= 0) || (delta > 0 && from >= max() - 1);
      if (atEnd && e.timeStamp > latchUntil) return;
      e.preventDefault();
      latchUntil = e.timeStamp + 250;
      if (atEnd) return;
      if (!easing) pos = row.scrollLeft;
      target = clamp(from + delta);
      run("ease");
    },
    { passive: false },
  );
}
export function gameMediaSections(
  row,
  { behind = null, onImageLoad, onSetAs: store } = {},
) {
  const sections = sectionsFor(row);
  if (!sections.length) return null;
  const caption = row?.name || "";
  // Whatever is picked is saved as the address the full-screen view shows.
  const onSetAs = store && ((kind, item) => store(kind, item.image));
  const box = el("div", "game-media");
  for (const section of sections)
    box.append(buildRow(section, { caption, behind, onImageLoad, onSetAs }));
  return box;
}
