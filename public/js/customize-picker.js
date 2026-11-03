// One image grid in the Customize drawer (Poster, Banner or Logo): every
// SteamGridDB image of that type for the game, in SteamGridDB's own order,
// static and animated, NSFW included, each with its size underneath.
// Behaviour only; the look is in css/customize.css.
//
//   createPicker({ kind, onSelect }) -> { element, setWaiting, setSource,
//     setSelected, activate, relayout, destroy }
//
// - Tiles show SteamGridDB's thumbnails; the full-size `url` is what gets
//   picked and stored. Animated thumbnails are .webm, so those tiles are a
//   muted looping video (still under reduced motion), playing only on screen.
// - Lists arrive 50 at a time as the grid nears its end, and are kept for
//   the visit, so reopening the drawer on the same game asks for nothing.
// - Images load visible first: at most LOADS at once, tiles on screen ahead
//   of tiles just off it, whatever their order. A tile scrolled away before
//   it finished is cancelled, so skipping to the bottom never waits on the
//   ones skipped. Once everything near the view is in, a few tiles further
//   down are fetched quietly so scrolling finds them ready.

import { displayImageUrl } from "/js/image-url.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import { KINDS } from "/js/game-art.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 40;
// Lists fetched ahead without scrolling stop at this many images.
const AHEAD_LIMIT = 150;
const SKELETONS = 12;
// Images downloading at once, and how many of those may be the quiet
// fetch-ahead, which only runs with nothing near the view left to load.
const LOADS = 6;
const AHEAD_LOADS = 2;
const AHEAD_TILES = 24;

const calmMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Lists already fetched this visit, by kind and SteamGridDB id.
const lists = new Map();
const LISTS_MAX = 30;
function keepList(key, entry) {
  lists.delete(key);
  lists.set(key, entry);
  if (lists.size > LISTS_MAX) lists.delete(lists.keys().next().value);
}

// Every shimmer shares one clock (as in the results grid), so tiles added
// later sweep in phase with the rest.
function syncShimmer(node) {
  if (typeof node.getAnimations !== "function") return;
  for (const animation of node.getAnimations({ subtree: true })) {
    animation.startTime = 0;
  }
}

async function fetchPage(kind, sgdbId, page) {
  const { call } = await import("/js/api.js");
  return call("sgdb", KINDS[kind], { sgdbId, limit: PAGE_SIZE, page });
}

const sizeOf = (item) =>
  item.width && item.height ? `${item.width} × ${item.height}` : "";

export function createPicker({ kind, onSelect }) {
  const element = document.createElement("div");
  element.className = "customize-pane overlay-scroll-host";
  element.hidden = true;
  const grid = document.createElement("div");
  grid.className = `picker-grid is-${kind}`;
  grid.setAttribute("role", "listbox");
  grid.setAttribute("aria-label", "Images");
  const message = document.createElement("p");
  message.className = "customize-empty";
  message.hidden = true;
  element.append(grid, message);

  let overlay = null;
  let sgdbId = null;
  let list = null; // { items, page, done } - shared with the `lists` cache
  let loading = false;
  let started = false;
  let token = 0;
  let selected = null;
  let pumpQueued = false;
  // Per tile: { item, index, tile, media, state, near, ahead, attempt }.
  const records = [];
  const byUrl = new Map();
  const byMedia = new Map();

  const observer = new IntersectionObserver(onNear, {
    root: element,
    rootMargin: "200px 0px",
  });

  function onNear(entries) {
    for (const entry of entries) {
      const rec = byMedia.get(entry.target);
      if (!rec) continue;
      rec.near = entry.isIntersecting;
      if (rec.media.tagName === "VIDEO") {
        if (rec.near && rec.state === "done" && !calmMotion())
          rec.media.play().catch(() => {});
        else if (!rec.near) rec.media.pause();
      }
      // Scrolled away before it finished: cancelled, so it doesn't hold up
      // the ones now on screen. It starts again when it comes back.
      if (!rec.near && rec.state === "loading" && !rec.ahead) cancel(rec);
    }
    schedulePump();
  }

  function cancel(rec) {
    rec.attempt += 1;
    rec.state = "idle";
    rec.media.removeAttribute("src");
    if (rec.media.tagName === "VIDEO") rec.media.load();
  }

  function settle(rec, ok) {
    rec.state = ok ? "done" : "failed";
    rec.tile.classList.remove("is-loading");
    rec.tile.classList.toggle("is-failed", !ok);
    if (ok && rec.media.tagName === "VIDEO" && rec.near && !calmMotion())
      rec.media.play().catch(() => {});
    schedulePump();
  }

  function start(rec, { ahead = false, urgent = false } = {}) {
    rec.state = "loading";
    rec.ahead = ahead;
    const mine = ++rec.attempt;
    const media = rec.media;
    const done = (ok) => mine === rec.attempt && settle(rec, ok);
    const src = media.dataset.src;
    if (media.tagName === "VIDEO") {
      media.preload = "auto";
      media.addEventListener("loadeddata", () => done(true), { once: true });
      media.addEventListener("error", () => done(false), { once: true });
      media.src = src;
    } else {
      media.fetchPriority = urgent ? "high" : "low";
      media.onload = () => done(true);
      media.onerror = () => done(false);
      media.src = src;
    }
  }

  function schedulePump() {
    if (pumpQueued) return;
    pumpQueued = true;
    requestAnimationFrame(() => {
      pumpQueued = false;
      pump();
      maybeMore();
    });
  }

  // On screen first, then near it, each in grid order; then the quiet
  // fetch-ahead below the last tile near the view (static images only).
  function pump() {
    if (element.hidden || !records.length) return;
    const view = element.getBoundingClientRect();
    const onScreen = (rec) => {
      const r = rec.tile.getBoundingClientRect();
      return r.bottom > view.top && r.top < view.bottom;
    };
    const wanted = records.filter((r) => r.near && r.state === "idle");
    wanted.sort((a, b) => onScreen(b) - onScreen(a) || a.index - b.index);
    let busy = records.filter((r) => r.state === "loading");
    for (const rec of wanted) {
      if (busy.length >= LOADS) {
        const quiet = busy.find((r) => r.ahead);
        if (!quiet) break;
        cancel(quiet);
        busy = busy.filter((r) => r !== quiet);
      }
      start(rec, { urgent: onScreen(rec) });
      busy.push(rec);
    }
    if (wanted.length || busy.length >= LOADS) return;
    let lastNear = -1;
    for (const rec of records) if (rec.near) lastNear = rec.index;
    if (lastNear < 0) return;
    let aheadBusy = busy.filter((r) => r.ahead).length;
    for (const rec of records.slice(lastNear + 1, lastNear + 1 + AHEAD_TILES)) {
      if (aheadBusy >= AHEAD_LOADS || busy.length >= LOADS) break;
      if (rec.state !== "idle" || rec.media.tagName === "VIDEO") continue;
      start(rec, { ahead: true });
      aheadBusy += 1;
      busy.push(rec);
    }
  }

  function buildTile(item, index) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "picker-tile is-loading";
    tile.setAttribute("role", "option");
    tile.dataset.url = item.url;
    const size = sizeOf(item);
    tile.setAttribute("aria-label", size || "Image");
    const art = document.createElement("span");
    art.className = "picker-art";
    const animated = /\.webm($|\?)/i.test(item.thumb ?? "");
    const media = document.createElement(animated ? "video" : "img");
    if (animated) {
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = "none";
    } else {
      media.alt = "";
      media.decoding = "async";
    }
    media.draggable = false;
    media.dataset.src = displayImageUrl(item.thumb || item.url, kind);
    art.append(media);
    // The size sits on the image, bottom left.
    const caption = document.createElement("span");
    caption.className = "picker-size";
    caption.textContent = size;
    caption.hidden = !size;
    art.append(caption);
    tile.append(art);
    const rec = {
      item,
      index,
      tile,
      media,
      state: "idle",
      near: false,
      ahead: false,
      attempt: 0,
    };
    records.push(rec);
    byUrl.set(item.url, rec);
    byMedia.set(media, rec);
    markTile(rec);
    return rec;
  }

  function markTile(rec) {
    const on = rec.item.url === selected;
    rec.tile.classList.toggle("is-selected", on);
    rec.tile.setAttribute("aria-selected", String(on));
  }

  function addTiles(items) {
    const added = [];
    for (const item of items) {
      if (byUrl.has(item.url)) continue;
      added.push(buildTile(item, records.length));
    }
    grid.append(...added.map((r) => r.tile));
    for (const rec of added) observer.observe(rec.media);
    syncShimmer(grid);
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function setSkeletons(on) {
    grid.querySelectorAll(".is-skeleton").forEach((s) => s.remove());
    if (!on) return;
    for (let i = 0; i < SKELETONS; i += 1) {
      const s = document.createElement("div");
      s.className = "picker-tile is-skeleton";
      s.setAttribute("aria-hidden", "true");
      const art = document.createElement("span");
      art.className = "picker-art";
      s.append(art);
      grid.append(s);
    }
    syncShimmer(grid);
  }

  async function loadMore() {
    if (loading || !list || list.done) return;
    loading = true;
    const mine = token;
    const entry = list;
    if (!entry.items.length) setSkeletons(true);
    try {
      const res = await fetchPage(kind, sgdbId, entry.page);
      const data = (res?.data ?? []).filter((item) => item?.url);
      entry.page += 1;
      const seen = new Set(entry.items.map((i) => i.url));
      entry.items.push(...data.filter((i) => !seen.has(i.url)));
      if (
        data.length < PAGE_SIZE ||
        entry.items.length >= (res?.total ?? 0) ||
        entry.page >= MAX_PAGES
      ) {
        entry.done = true;
      }
      if (mine !== token) return;
      setSkeletons(false);
      addTiles(entry.items);
      if (entry.done && !entry.items.length)
        showMessage("No Results Available");
    } catch {
      if (mine !== token) return;
      setSkeletons(false);
      // Not kept as done: the next opening tries again.
      lists.delete(`${kind}:${sgdbId}`);
      list = { ...entry, done: true };
      if (!entry.items.length) showMessage("Couldn't Reach SteamGridDB");
    } finally {
      if (mine === token) {
        loading = false;
        schedulePump();
      }
    }
  }

  // More when the grid is within a screen and a half of its end, or (up to
  // AHEAD_LIMIT) once nothing is downloading.
  function maybeMore() {
    if (loading || !list || list.done || element.hidden) return;
    const left =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearEnd = left < element.clientHeight * 1.5;
    const idle =
      !records.some((r) => r.state === "loading") &&
      list.items.length < AHEAD_LIMIT;
    if (nearEnd || idle) loadMore();
  }

  const onScroll = () => {
    schedulePump();
  };
  const onClick = (event) => {
    const tile = event.target.closest(".picker-tile[data-url]");
    const rec = tile && byUrl.get(tile.dataset.url);
    if (rec) onSelect?.(rec.item);
  };
  element.addEventListener("scroll", onScroll, { passive: true });
  grid.addEventListener("click", onClick);

  function reset() {
    token += 1;
    loading = false;
    started = false;
    list = null;
    sgdbId = null;
    observer.disconnect();
    for (const rec of records) if (rec.state === "loading") cancel(rec);
    records.length = 0;
    byUrl.clear();
    byMedia.clear();
    grid.replaceChildren();
    showMessage("");
    element.scrollTop = 0;
  }

  return {
    element,
    // While the game's row is still loading: skeletons, nothing asked for.
    setWaiting() {
      reset();
      started = true;
      setSkeletons(true);
    },
    // The game's SteamGridDB id, or null/0 for none (shows the empty text).
    setSource(id) {
      reset();
      if (!(id > 0)) {
        showMessage("No Results Available");
        return;
      }
      sgdbId = id;
      const key = `${kind}:${id}`;
      list = lists.get(key) ?? { items: [], page: 0, done: false };
      keepList(key, list);
      if (list.items.length) {
        started = true;
        addTiles(list.items);
        if (list.done && !list.items.length)
          showMessage("No Results Available");
      }
    },
    setSelected(url) {
      selected = url ?? null;
      for (const rec of records) markTile(rec);
    },
    // Shown (its tab became active): the overlay indicator is made on first
    // show, and the first page is asked for.
    activate() {
      overlay ??= createOverlayScroll({
        scroller: element,
        content: grid,
        top: 4,
        bottom: 4,
      });
      overlay.update();
      if (!started && list) {
        started = true;
        loadMore();
      }
      schedulePump();
    },
    // The slider changed the columns: what is near the view changed too.
    relayout() {
      overlay?.update();
      schedulePump();
    },
    destroy() {
      reset();
      overlay?.destroy();
      element.removeEventListener("scroll", onScroll);
      grid.removeEventListener("click", onClick);
    },
  };
}
