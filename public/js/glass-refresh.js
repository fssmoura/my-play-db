// Asks liquidGL to re-photograph the page. The glass shows a snapshot of the
// page, and liquidGL only retakes it when the page's size changes (debounced),
// so changes that don't resize it - cards hidden by a filter, skeletons
// swapped for cards, a list emptied - leave the glass showing the old page.
// Call this after any such change; several calls in one frame become one
// capture. Bumping the capture generation makes liquidGL discard a capture
// already in flight and start a fresh one, instead of ignoring the request.
// (Reaches into liquidGL's renderer; the vendored file has no public call.)

let queued = false;

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
// Call this on every scroll event. It retakes the snapshot back to back while
// scrolling continues (one capture at a time, never discarding one in flight,
// so it can't starve itself), and once more shortly after scrolling stops.
let chasing = false;
let wantMore = false;
let settleTimer = 0;
const SETTLE_MS = 120;

export function refreshGlassWhileScrolling() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(refreshGlass, SETTLE_MS);
  wantMore = true;
  if (!chasing) chase();
}

async function chase() {
  chasing = true;
  let guard = 0;
  while (wantMore && guard++ < 400) {
    const list = renderers();
    if (!list.length) break;
    wantMore = false;
    if (list.some((r) => r._capturing)) {
      wantMore = true;
      await new Promise((r) => setTimeout(r, 30));
      continue;
    }
    try {
      await Promise.all(list.map((r) => r.captureSnapshot()));
    } catch {
      // The next scroll tick tries again.
    }
  }
  wantMore = false;
  chasing = false;
}