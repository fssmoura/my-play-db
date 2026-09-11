/**
 * Search: one IGDB request per query, cached, ranked, with a local head start.
 *
 * A search returns everything a result card needs, so there is no second
 * lookup to fill in covers or descriptions - the typeahead and the full list
 * are the same list, and paging through it costs nothing.
 *
 * TWO STAGES, ONE IGDB REQUEST
 *
 * The `games` table and IGDB are asked at the same moment. The local lookup
 * lands in ~50ms and paints through `onPartial`; IGDB lands in ~600ms, is
 * merged over the top by id, and resolves the promise. That is a head start,
 * not a second source - IGDB remains the answer, and the local rows only ever
 * get there first.
 *
 * This is still one IGDB request per query. If you find yourself adding a
 * second one to this path, that is the mistake repeating.
 *
 * Ranking and list maths live in `ranking.js` (pure). Cache reads and writes
 * live in `games-cache.js`. This file is only about orchestrating the two.
 */
import { call } from "./api.js";
import { rankGames, narrow, mergeById } from "./ranking.js";
import {
  searchCached,
  saveSearchResults,
  clearCache as clearGamesCache,
} from "./games-cache.js";

/** How many suggestions the typeahead shows. */
export const QUICK_LIMIT = 5;
/** How many results one search asks for. IGDB caps this at 500. */
export const SEARCH_LIMIT = 200;
/** How many results are shown per page. */
export const PAGE_SIZE = 20;
/** How long to wait after the last keystroke before searching. */
export const DEBOUNCE_MS = 150;

const cache = new Map();
const CACHE_MAX = 60;

/**
 * In-flight searches, keyed like the cache. Each entry holds both halves of a
 * search, so two callers wanting the same query at the same time (typing, then
 * immediately hitting Search) share one IGDB request *and* one cache lookup
 * rather than each firing their own.
 */
const inflight = new Map();

/** The last list we got, so the next keystroke has something to narrow. */
let last = { query: "", games: [] };

export function clearCache() {
  cache.clear();
  inflight.clear();
  clearGamesCache();
  last = { query: "", games: [] };
}

function cacheKey(query, type) {
  return `${query}|${type ?? ""}`;
}

/** Starts both halves of a search and returns them separately. */
function begin(term, type, key) {
  // Hardened to never reject: no head start is a non-event, not an error, and
  // this promise is also listened to on the onPartial channel where a
  // rejection would go unhandled.
  const cached = searchCached(term, type).catch(() => []);

  const games = (async () => {
    const options = { query: term, limit: SEARCH_LIMIT };
    if (type != null && !Number.isNaN(type)) options.type = type;

    const raw = await call("igdb", "search", options);
    const fresh = Array.isArray(raw) ? raw : [];

    // Cached rows carry the same ranking fields as fresh ones, so merging and
    // re-ranking cannot reshuffle what the head start already put on screen -
    // it can only add to it.
    const ranked = rankGames(mergeById(await cached, fresh), term);

    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, ranked);
    last = { query: term, games: ranked };
    return ranked;
  })().finally(() => inflight.delete(key));

  return { cached, games };
}

/**
 * Searches and returns the games ranked best-first.
 *
 * @param {string} query
 * @param {object} opts
 * @param {number|string|null} [opts.type] filters by game_type server-side;
 *   "" or null means no filter.
 * @param {(games: object[]) => void} [opts.onPartial] called with locally
 *   cached results if they arrive before IGDB does. Never called after the
 *   returned promise settles, and never called with an empty list, so a caller
 *   only ever hears about a head start worth drawing.
 */
export async function search(query, opts = {}) {
  const term = String(query ?? "").trim();
  if (!term) return [];

  const type = opts.type === "" || opts.type == null ? null : Number(opts.type);
  const key = cacheKey(term, type);

  const cached = cache.get(key);
  if (cached) {
    last = { query: term, games: cached };
    return cached;
  }

  let entry = inflight.get(key);
  if (!entry) {
    entry = begin(term, type, key);
    inflight.set(key, entry);
  }

  let settled = false;
  if (typeof opts.onPartial === "function") {
    entry.cached.then((games) => {
      if (!settled && games.length) opts.onPartial(games);
    });
  }

  return entry.games.finally(() => {
    settled = true;
  });
}

/**
 * Writes a committed search back to the local cache, so the next search for
 * these games has a head start and so the catalogue grows as it is used.
 * Deliberately not awaited by callers - it must never delay or fail a search.
 */
export function remember(games) {
  return saveSearchResults(games);
}

/**
 * Instant, network-free results for a query that extends the last one, so the
 * dropdown updates while you type instead of waiting ~500ms for a round trip.
 * Returns null when there is nothing sensible to narrow.
 */
export function narrowLast(query) {
  return narrow(last.games, last.query, query);
}

/**
 * Warms the serverless function and the server's IGDB token so the first real
 * search isn't also paying for a cold start. Failures are ignored - this is an
 * optimisation, not a dependency.
 */
export async function warmUp() {
  try {
    await call("igdb", "auth", {});
  } catch {
    /* ignore */
  }
}

/**
 * Calls `fn` only after `wait` ms of quiet. The returned function exposes
 * `.cancel()` so a view can drop a pending call.
 */
export function debounce(fn, wait = DEBOUNCE_MS) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}
