/**
 * The media picker.
 *
 * Reached only from a game page's "Select media" button, never from the tab
 * bar directly. Its job is to let one SteamGridDB image be chosen as the
 * cover, logo and banner for a game.
 *
 * Choosing does not replace anything. The chosen URL is moved to the front of
 * its column and everything already there stays behind it - see
 * `saveChosenArt()` in games-cache.js for why the front of the array is the
 * choice.
 *
 * All data decisions live in games-cache.js and sgdb.js. This file only draws.
 */
import { loadGame, saveChosenArt, saveSgdbId } from "../games-cache.js";
import { forget } from "../game.js";
import { resolveSgdb } from "../sgdb.js";
import { call } from "../api.js";
import { go, onNavigate } from "../navigate.js";

let root;
let sequence = 0;

/**
 * The three media types, and which SteamGridDB endpoint serves each.
 *
 * SteamGridDB's names differ from ours: a cover is a "grid", a banner is a
 * "hero". The `fit` decides how an image sits in its frame - logos are
 * transparent artwork of no fixed shape, so cropping one would cut the game's
 * name in half.
 */
const TYPES = [
  { key: "cover", label: "Cover", action: "grids", fit: "cover" },
  { key: "logo", label: "Logo", action: "logos", fit: "contain" },
  { key: "banner", label: "Banner", action: "heroes", fit: "cover" },
];

const REVIEW = "review";

/** SteamGridDB's own page size. Everything is fetched, a page at a time. */
const PAGE_SIZE = 50;

/** A guard against a runaway loop, not a limit on results. */
const MAX_PAGES = 40;

const state = {
  gameId: null,
  row: null,
  sgdbId: null,
  matchNote: "",
  tab: "cover",
  size: 3,
  picks: { cover: null, logo: null, banner: null },
  // key -> { items, total, loading, done, error }
  assets: {},
};

/* ------------------------------------------------------------------ mount -- */

export async function mount(el) {
  root = el;
  root.innerHTML = `<div class="media-page" id="m-root"></div>`;

  window.addEventListener("popstate", () => restoreFromUrl());
  onNavigate((view) => {
    if (view === "media") restoreFromUrl();
  });

  await restoreFromUrl();
}

/** Opens the picker for a game. */
export function open(id) {
  go("media", { media: Number(id) });
}

function node() {
  return root.querySelector("#m-root");
}

async function restoreFromUrl() {
  const id = new URLSearchParams(location.search).get("media");
  if (!id) return message("Open a game and choose \u201cSelect media\u201d.");

  const gameId = Number(id);
  if (!Number.isFinite(gameId)) return message(`Not a game id: ${id}`, true);

  // Re-entering the same game keeps whatever was already loaded and chosen.
  if (state.gameId === gameId && state.row) return render();

  const mine = ++sequence;
  message("Loading\u2026");

  reset(gameId);

  try {
    state.row = await loadGame(gameId);
  } catch (error) {
    return message(error.message, true);
  }
  if (mine !== sequence) return;

  if (!state.row) {
    return message(
      `Game ${gameId} is not in the database yet. Open its page first.`,
      true,
    );
  }

  render();
  await resolveMatch(mine);
}

function reset(gameId) {
  state.gameId = gameId;
  state.row = null;
  state.sgdbId = null;
  state.matchNote = "";
  state.tab = "cover";
  state.picks = { cover: null, logo: null, banner: null };
  state.assets = {};
}

/* ------------------------------------------------------------------ match -- */

/**
 * Finds the SteamGridDB entry for this game.
 *
 * A stored id is trusted and never re-checked - it may have been set by hand,
 * and second-guessing that would undo the point of letting it be set.
 */
async function resolveMatch(mine) {
  if (state.row.sgdb_id) {
    state.sgdbId = state.row.sgdb_id;
    state.matchNote = "stored match";
    render();
    return;
  }

  state.matchNote = "searching SteamGridDB\u2026";
  render();

  let match = null;
  try {
    match = await resolveSgdb(state.row);
  } catch (error) {
    if (mine !== sequence) return;
    state.matchNote = `match failed: ${error.message}`;
    return render();
  }
  if (mine !== sequence) return;

  if (!match) {
    state.matchNote = "no match found on SteamGridDB";
    return render();
  }

  state.sgdbId = match.sgdbId;
  state.matchNote = `matched by ${match.method} (${match.confidence}) \u2013 ${match.sgdbName}`;
  render();

  try {
    await saveSgdbId(state.gameId, match.sgdbId);
    state.row.sgdb_id = match.sgdbId;
  } catch {
    // Not being able to remember the match is not worth blocking the picker.
  }
}

async function useManualId(value) {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    state.matchNote = "that is not a SteamGridDB id";
    return render();
  }

  state.sgdbId = id;
  state.assets = {};
  state.picks = { cover: null, logo: null, banner: null };
  state.matchNote = "set by hand";
  render();

  try {
    await saveSgdbId(state.gameId, id);
    state.row.sgdb_id = id;
  } catch (error) {
    state.matchNote = `set, but not saved: ${error.message}`;
    render();
  }
}

/* ----------------------------------------------------------------- assets -- */

function bucket(key) {
  state.assets[key] ??= {
    items: [],
    total: null,
    loading: false,
    done: false,
    error: null,
  };
  return state.assets[key];
}

/**
 * Loads every image of one type, a page at a time.
 *
 * Deliberately unfiltered - no size, style or content filter - so what is on
 * screen is everything SteamGridDB holds for this game. Each page is drawn as
 * it lands rather than waiting for the last one, because a popular game can
 * have several hundred images and waiting for all of them before showing any
 * would make the tab feel broken.
 */
async function loadAssets(key) {
  const type = TYPES.find((t) => t.key === key);
  const store = bucket(key);
  if (store.loading || store.done || !state.sgdbId) return;

  store.loading = true;
  store.error = null;
  paint(key);

  const mine = sequence;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await call("sgdb", type.action, {
        sgdbId: state.sgdbId,
        limit: PAGE_SIZE,
        page,
      });
      if (mine !== sequence) return;

      store.total = res?.total ?? store.items.length;
      store.items.push(...(res?.data ?? []));
      paint(key);

      if (!res?.data?.length || store.items.length >= store.total) break;
    }
    store.done = true;
  } catch (error) {
    store.error = error.message;
  } finally {
    store.loading = false;
    if (mine === sequence) paint(key);
  }
}

/* --------------------------------------------------------------- rendering -- */

function message(text, isError = false) {
  node().innerHTML = `<p class="meta ${isError ? "error" : ""}">${escapeHtml(text)}</p>`;
}

function render() {
  const row = state.row;
  const tabs = [...TYPES.map((t) => [t.key, t.label]), [REVIEW, "Review"]];

  node().innerHTML = `
    <header class="media-head">
      <h2>${escapeHtml(row?.name ?? "")}</h2>
      <p class="meta">
        IGDB ${state.gameId}
        ${state.sgdbId ? ` &middot; SteamGridDB ${state.sgdbId}` : ""}
      </p>
      <p class="meta" id="m-note">${escapeHtml(state.matchNote)}</p>
      <div class="button-row">
        <button type="button" id="m-back">Back to game</button>
        <label for="m-manual" class="meta">SteamGridDB id</label>
        <input
          type="number"
          id="m-manual"
          placeholder="${state.sgdbId ?? "e.g. 5246746"}"
        />
        <button type="button" id="m-use">Use this id</button>
      </div>
    </header>

    <nav class="subtabs" id="m-tabs">
      ${tabs
        .map(
          ([key, label]) => `
        <button
          type="button"
          data-tab="${key}"
          aria-selected="${String(key === state.tab)}"
        >${label}${pickMark(key)}</button>`,
        )
        .join("")}
    </nav>

    <div id="m-panel"></div>
  `;

  node()
    .querySelector("#m-back")
    .addEventListener("click", () => go("game", { game: state.gameId }));

  node()
    .querySelector("#m-use")
    .addEventListener("click", () => {
      useManualId(node().querySelector("#m-manual").value);
    });

  node()
    .querySelectorAll("#m-tabs button")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.tab;
        render();
      }),
    );

  renderPanel();
}

/** A dot beside a tab name once something has been chosen for it. */
function pickMark(key) {
  return key !== REVIEW && state.picks[key] ? " &bull;" : "";
}

function renderPanel() {
  const panel = node().querySelector("#m-panel");

  // The old grid is gone; stop watching its tiles so their videos stop too.
  mediaObserver?.disconnect();

  if (state.tab === REVIEW) {
    panel.innerHTML = renderReview();
    panel.querySelector("#m-save")?.addEventListener("click", save);
    panel.querySelectorAll("[data-clear]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.picks[btn.dataset.clear] = null;
        render();
      }),
    );
    return;
  }

  if (!state.sgdbId) {
    panel.innerHTML = `<p class="meta">
      No SteamGridDB entry for this game. Enter an id above to link one by
      hand - that is also how a console or special edition can borrow the
      artwork of the release it shares its art with.
    </p>`;
    return;
  }

  panel.innerHTML = `
    <div class="button-row media-toolbar">
      <label for="m-size" class="meta">Grid size</label>
      <input type="range" id="m-size" min="1" max="5" value="${state.size}" />
      <span class="meta" id="m-count"></span>
    </div>
    <div class="media-grid is-${state.tab} is-size-${state.size}" id="m-grid"></div>
  `;

  panel.querySelector("#m-size").addEventListener("input", (event) => {
    state.size = Number(event.target.value);
    const grid = node().querySelector("#m-grid");
    for (let n = 1; n <= 5; n += 1) grid.classList.remove(`is-size-${n}`);
    grid.classList.add(`is-size-${state.size}`);
  });

  paint(state.tab);
  loadAssets(state.tab);
}

/** Redraws one type's grid in place. Cheap enough to call on every page. */
function paint(key) {
  if (state.tab !== key) return;
  const grid = node()?.querySelector("#m-grid");
  if (!grid) return;

  const store = bucket(key);
  const count = node().querySelector("#m-count");

  if (count) {
    count.textContent = store.error
      ? store.error
      : store.total == null
        ? "loading\u2026"
        : `${store.items.length} of ${store.total}`;
  }

  const tiles = store.items.map((item) => renderTile(key, item)).join("");
  const skeletons = store.loading
    ? Array.from(
        { length: 12 },
        () => `<div class="media-tile is-skeleton"></div>`,
      ).join("")
    : "";

  grid.innerHTML = tiles + skeletons;

  grid.querySelectorAll("[data-url]").forEach((tile) =>
    tile.addEventListener("click", () => {
      state.picks[key] = tile.dataset.url;
      render();
    }),
  );

  observeTiles(grid);
}

/**
 * Loads each tile's media only as it scrolls near the viewport, and pauses
 * video the moment it scrolls away again.
 *
 * Without this, opening one popular game fires off every image at once. Static
 * thumbnails are ~55KB each and there can be hundreds of them; animated
 * previews run to several megabytes apiece. That flood fills the browser's per
 * host connection pool, and while it drains, images on every other tab stall
 * with it.
 *
 * Reduced motion is respected: with the system setting on, videos load their
 * first frame and stay still.
 */
let mediaObserver = null;

/** Whether the system asks for stillness instead of motion. */
const calmMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function observeTiles(grid) {
  mediaObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const media = entry.target;
        if (entry.isIntersecting) {
          if (media.tagName === "VIDEO") {
            if (!media.getAttribute("src")) {
              media.src = media.dataset.src;
            }
            if (!calmMotion()) media.play().catch(() => {});
          } else if (!media.getAttribute("src")) {
            media.src = media.dataset.src;
          }
        } else if (media.tagName === "VIDEO") {
          media.pause();
        }
      }
    },
    // Start loading a little before the tile is actually visible, so scrolling
    // never shows a blank frame it has to wait on.
    { rootMargin: "400px" },
  );
  grid.querySelectorAll("[data-src]").forEach((media) => {
    mediaObserver.observe(media);
  });
}

/**
 * One image.
 *
 * The thumbnail is what gets drawn and the full-size URL is what gets saved -
 * a grid of several hundred full-size images would take far too long to load
 * to be usable.
 *
 * Animated artwork breaks that rule slightly. SteamGridDB serves its animated
 * thumbnails as `.webm`, which is a video and not something an `<img>` can
 * show, so those tiles get a muted looping `<video>` instead. The saved URL is
 * still the full-size image either way.
 *
 * Nothing here has a `src` up front. Tile media is loaded by `observeTiles()`
 * below, only as it scrolls near - a popular game holds several hundred
 * images, and firing them all off at once (some animated previews are several
 * megabytes) saturates the connection pool and slows down images everywhere
 * else in the app too.
 */
function renderTile(key, item) {
  const chosen = state.picks[key] === item.url;
  const animated = /\.webm($|\?)/i.test(item.thumb ?? "");
  const media = animated
    ? `<video data-src="${escapeHtml(item.thumb)}" preload="none" loop muted playsinline></video>`
    : `<img data-src="${escapeHtml(item.thumb ?? item.url)}" alt="" loading="lazy" decoding="async" />`;

  return `
    <button
      type="button"
      class="media-tile ${chosen ? "is-chosen" : ""}"
      data-url="${escapeHtml(item.url)}"
      title="${escapeHtml(item.author?.name ? `by ${item.author.name}` : "")}"
    >
      ${media}
      <span class="meta">${escapeHtml(describe(item, animated))}</span>
    </button>`;
}

/** The caption under a tile: what the image is, not who made it. */
function describe(item, animated) {
  return [
    item.width && item.height ? `${item.width}\u00d7${item.height}` : null,
    item.style,
    animated ? "animated" : null,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
}

function renderReview() {
  const rows = TYPES.map((type) => {
    const current = state.row?.[type.key]?.[0] ?? null;
    const picked = state.picks[type.key];
    return `
      <div class="media-review-row">
        <h4>${type.label}</h4>
        <div class="media-review-pair">
          <figure>
            <div class="media-review-frame is-${type.key}">
              ${current ? `<img src="${escapeHtml(current)}" alt="" />` : `<span class="meta">none</span>`}
            </div>
            <figcaption class="meta">current</figcaption>
          </figure>
          <figure>
            <div class="media-review-frame is-${type.key}">
              ${picked ? `<img src="${escapeHtml(picked)}" alt="" />` : `<span class="meta">unchanged</span>`}
            </div>
            <figcaption class="meta">
              ${picked ? `new` : `nothing chosen`}
              ${picked ? ` <button type="button" data-clear="${type.key}">clear</button>` : ""}
            </figcaption>
          </figure>
        </div>
      </div>`;
  }).join("");

  const chosen = TYPES.filter((t) => state.picks[t.key]).length;

  return `
    <div class="media-review">
      ${rows}
      <p class="meta">
        Saving moves each chosen image to the front of its column. Nothing is
        deleted - what is there now stays behind it.
      </p>
      <div class="button-row">
        <button type="button" id="m-save" ${chosen ? "" : "disabled"}>
          ${chosen ? `Save ${chosen} change${chosen === 1 ? "" : "s"}` : "Nothing to save"}
        </button>
        <span class="meta" id="m-saved"></span>
      </div>
    </div>`;
}

async function save() {
  const saved = node().querySelector("#m-saved");
  const button = node().querySelector("#m-save");
  button.disabled = true;
  saved.textContent = "saving\u2026";

  try {
    await saveChosenArt(state.gameId, state.picks);
    // The game page holds its own short-lived copy of the row; without this it
    // would show the old images straight after saving.
    forget(state.gameId);
    state.picks = { cover: null, logo: null, banner: null };
    // Done: back to the game page, which shows the new images. Leaving the
    // tab closes it (see wireTabs in app.js).
    go("game", { game: state.gameId });
  } catch (error) {
    saved.textContent = error.message;
    button.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
