// Asks liquidGL to re-photograph the page. The glass shows a snapshot of the
// page, and liquidGL only retakes it when the page's size changes (debounced),
// so changes that don't resize it - cards hidden by a filter, skeletons
// swapped for cards, a list emptied - leave the glass showing the old page.
// Call this after any such change; several calls in one frame become one
// capture. Bumping the capture generation makes liquidGL discard a capture
// already in flight and start a fresh one, instead of ignoring the request.
// (Reaches into liquidGL's renderer; the vendored file has no public call.)

let queued = false;

// Re-photographs only the renderers whose snapshot is `target` (the
// full-screen image viewer), coalesced to one capture per frame.
const queuedTargets = new Set();
export function refreshGlassOf(target) {
  if (queuedTargets.has(target)) return;
  queuedTargets.add(target);
  requestAnimationFrame(() => {
    queuedTargets.delete(target);
    for (const renderer of renderers()) {
      if (renderer.snapshotTarget !== target) continue;
      renderer._captureGeneration = (renderer._captureGeneration || 0) + 1;
      renderer.captureSnapshot()?.catch?.(() => {});
    }
  });
}

// Re-photographs only the renderers with a lens inside `container` (the
// Customize drawer, which covers the page: the page's own glass is hidden
// under it and keeps its photo of the page for when the drawer closes).
const queuedWithin = new Set();
export function refreshGlassWithin(container) {
  if (queuedWithin.has(container)) return;
  queuedWithin.add(container);
  requestAnimationFrame(() => {
    queuedWithin.delete(container);
    for (const renderer of renderers()) {
      if (!renderer.lenses?.some((lens) => container.contains(lens.el)))
        continue;
      renderer._captureGeneration = (renderer._captureGeneration || 0) + 1;
      renderer.captureSnapshot()?.catch?.(() => {});
    }
  });
}

// liquidGL keeps one renderer (one snapshot) per z-index layer, and only the
// first is reachable as window.__liquidGLRenderer__. menu.js hands over every
// lens so all layers - search pill, pull-downs - get the fresh snapshot too.
const tracked = new Set();

export function trackGlassLenses(lenses) {
  tracked.clear();
  for (const lens of lenses) if (lens?.renderer) tracked.add(lens.renderer);
}

function renderers() {
  const all = new Set(tracked);
  if (window.__liquidGLRenderer__) all.add(window.__liquidGLRenderer__);
  return [...all].filter((r) => !r._destroyed);
}

export function refreshGlass() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const renderer of renderers()) {
      renderer._captureGeneration = (renderer._captureGeneration || 0) + 1;
      renderer.captureSnapshot()?.catch?.(() => {});
    }
  });
}

// For content that scrolls inside an element (the game page): the glass tracks
// only the document's own scroll, so it would keep showing the page as it was.
// Call this on every scroll event. Every capture photographs the whole page
// once per glass layer, which is by far the most expensive thing on the page
// (measured ~28ms per frame at 4x CPU slowdown when done every frame), so live
// recaptures are rate-limited to one per LIVE_GAP_MS; `live: false` skips them
// and leaves only the final capture shortly after scrolling stops.
let settleTimer = 0;
let liveTimer = 0;
let lastLive = 0;
const SETTLE_MS = 120;
const LIVE_GAP_MS = 150;

export function refreshGlassWhileScrolling({ live = true } = {}) {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(refreshGlass, SETTLE_MS);
  if (!live || liveTimer) return;
  const wait = Math.max(0, lastLive + LIVE_GAP_MS - performance.now());
  liveTimer = setTimeout(() => {
    liveTimer = 0;
    lastLive = performance.now();
    refreshGlass();
  }, wait);
}
