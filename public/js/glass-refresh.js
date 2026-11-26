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
  for (const [lensEl, [target, options]] of follows)
    pointGlass(lensEl, target, options);
}

function renderers() {
  const all = new Set(tracked);
  if (window.__liquidGLRenderer__) all.add(window.__liquidGLRenderer__);
  return [...all].filter((r) => !r._destroyed);
}

// The page background as the glass sees it: liquidGL's own rule (the root's
// colour, else the body's, laid over white).
function pageBackground() {
  const clear = (c) => c === "transparent" || /,\s*0\)$/.test(c);
  const root = getComputedStyle(document.documentElement);
  let color = root.backgroundColor;
  if (clear(color) && root.backgroundImage === "none")
    color = getComputedStyle(document.body).backgroundColor;
  return clear(color) ? "#fff" : color;
}

// Swaps every photo of the page for a plain one of its background, at once.
// For a cover that hides the whole page (the game sheet): a real photo takes a
// moment, and until it lands the glass would keep showing the page behind.
// Follow with refreshGlass() for what the cover itself puts there.
export function blankGlass() {
  const body = document.body;
  const w = body.scrollWidth;
  const h = body.scrollHeight;
  if (!w || !h) return;
  const color = pageBackground();
  for (const renderer of renderers()) {
    if (!renderer.hasTexture || renderer.snapshotTarget !== body) continue;
    const scale = renderer.scaleFactor || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Drops any photo still being taken of the old page.
    renderer._captureGeneration = (renderer._captureGeneration || 0) + 1;
    renderer._uploadTexture?.(canvas, true);
  }
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

// Points the glass of `lensEl` (and the other lenses sharing its renderer) at
// `target` instead of the page, the way it photographs the page: one photo,
// slid along as `target` moves, so scrolling inside it costs no new photos.
// `ignore(el)` leaves elements out of the photo; `pieces()` lists elements
// that move differently from `target` (pinned, or scrolling sideways), back
// to front as { el, clip } (clip: the element whose box they're seen
// through). Those are photographed one by one and drawn over the photo where
// they are right now, every frame, under the lenses only. Pass target null to
// go back to the page. Remembered, so it also applies to glass made later.
const follows = new Map();
export function glassPhotographs(lensEl, target, options = {}) {
  if (!lensEl) return;
  if (target) follows.set(lensEl, [target, options]);
  else follows.delete(lensEl);
  pointGlass(lensEl, target || document.body, options);
}

function pointGlass(lensEl, target, { ignore = null, pieces = null } = {}) {
  for (const renderer of renderers()) {
    if (!renderer.lenses?.some((lens) => lens.el === lensEl)) continue;
    if (renderer.snapshotTarget === target) continue;
    const page = target === document.body;
    renderer.snapshotTarget = target;
    renderer.ignore = page ? null : ignore;
    renderer.background = page ? null : pageBackground();
    renderer.beforeLenses = page || !pieces ? null : livePieces(pieces);
    renderer._captureGeneration = (renderer._captureGeneration || 0) + 1;
    renderer.captureSnapshot()?.catch?.(() => {});
  }
}

// How far around each lens the pieces are drawn (CSS px): the glass bends in
// a little from around its edge.
const REACH = 24;

// Runs every frame, just before liquidGL draws the lenses. Patches only the
// parts of the photo under the lenses, and only when something moved.
function livePieces(list) {
  let photo = null;
  let items = [];
  let shots = new Map();
  let drawn = [];
  let last = "";
  const ctx = document.createElement("canvas").getContext("2d");

  async function photograph(renderer, forPhoto) {
    for (const { el } of items) {
      if (photo !== forPhoto) return;
      try {
        const shot = await renderer.photographPiece(el);
        if (photo !== forPhoto) return;
        shots.set(el, shot);
        last = "";
      } catch {
        // Left out of the glass; the page itself is unaffected.
      }
    }
  }

  function upload(renderer, x, y, w, h, draw) {
    const canvas = ctx.canvas;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(photo, x, y, w, h, 0, 0, w, h);
    draw?.();
    renderer.backend.uploadRegion(x, y, canvas);
  }

  return (renderer) => {
    const still = renderer.staticSnapshotCanvas;
    if (!renderer.hasTexture || !still || !renderer.backend) return;
    if (still !== photo) {
      // A new photo (already without pieces): photograph them again for it.
      photo = still;
      items = list();
      shots = new Map();
      drawn = [];
      last = "";
      photograph(renderer, still);
    }
    const scale = renderer.scaleFactor || 1;
    const snap = renderer._frameSnapRect;
    const W = renderer.textureWidth;
    const H = renderer.textureHeight;

    const placed = [];
    for (const { el, clip } of items) {
      const shot = shots.get(el);
      if (!shot || !el.isConnected) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      placed.push({ shot, rect, clip: (clip || el).getBoundingClientRect() });
    }
    const areas = [];
    for (const lens of renderer.lenses) {
      const r = lens.rectPx;
      if (!r || !r.width || !r.height) continue;
      const x = clamp(Math.floor((r.left - REACH - snap.left) * scale), 0, W);
      const y = clamp(Math.floor((r.top - REACH - snap.top) * scale), 0, H);
      const x2 = clamp(
        Math.ceil((r.left + r.width + REACH - snap.left) * scale),
        0,
        W,
      );
      const y2 = clamp(
        Math.ceil((r.top + r.height + REACH - snap.top) * scale),
        0,
        H,
      );
      if (x2 > x && y2 > y) areas.push({ x, y, w: x2 - x, h: y2 - y });
    }

    const state = [snap.left, snap.top, W, H];
    for (const a of areas) state.push(a.x, a.y, a.w, a.h);
    for (const p of placed)
      state.push(
        p.rect.left,
        p.rect.top,
        p.clip.left,
        p.clip.top,
        p.clip.right,
      );
    const key = state.join();
    if (key === last) return;
    last = key;

    // Where pieces were drawn last frame goes back to the plain photo first.
    for (const d of drawn) upload(renderer, d.x, d.y, d.w, d.h);
    drawn = [];
    for (const a of areas) {
      const toTex = (v, origin) => (v - origin) * scale;
      const hits = placed.filter((p) => {
        const left = Math.max(p.rect.left, p.clip.left);
        const top = Math.max(p.rect.top, p.clip.top);
        const right = Math.min(p.rect.right, p.clip.right);
        const bottom = Math.min(p.rect.bottom, p.clip.bottom);
        return (
          right > left &&
          bottom > top &&
          toTex(left, snap.left) < a.x + a.w &&
          toTex(right, snap.left) > a.x &&
          toTex(top, snap.top) < a.y + a.h &&
          toTex(bottom, snap.top) > a.y
        );
      });
      if (!hits.length) continue;
      upload(renderer, a.x, a.y, a.w, a.h, () => {
        for (const p of hits) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            toTex(p.clip.left, snap.left) - a.x,
            toTex(p.clip.top, snap.top) - a.y,
            p.clip.width * scale,
            p.clip.height * scale,
          );
          ctx.clip();
          ctx.drawImage(
            p.shot,
            toTex(p.rect.left, snap.left) - a.x,
            toTex(p.rect.top, snap.top) - a.y,
            p.rect.width * scale,
            p.rect.height * scale,
          );
          ctx.restore();
        }
      });
      drawn.push(a);
    }
  };
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
