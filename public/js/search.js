/**
 * IGDB search: one request per query, cached, ranked.
 *
 * A search returns everything a result card needs, so there is no second
 * lookup to fill in covers or descriptions - the typeahead and the full list
 * are the same list, and paging through it costs nothing.
 *
 * Ranking and list maths live in `ranking.js` (pure, unit-tested). This file
 * is only about fetching and caching.
 */
import { call } from "./api.js";
import { rankGames, narrow } from "./ranking.js";

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
 * In-flight requests, keyed like the cache. Without this, two things wanting
 * the same query at the same time (typing, then immediately hitting Search)
 * each fire their own request and wait on the slower one.
 */
const inflight = new Map();

/** The last list we got, so the next keystroke has something to narrow. */
let last = { query: "", games: [] };

export function clearCache() {
  cache.clear();
  inflight.clear();
  last = { query: "", games: [] };
}

function cacheKey(query, type) {
  return `${query}|${type ?? ""}`;
}

/**
 * Searches IGDB and returns the games ranked best-first.
 *
 * @param {string} query
 * @param {{ type?: number|string|null }} opts `type` filters by game_type
 *   server-side; "" or null means no filter.
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

  const running = inflight.get(key);
  if (running) return running;

  const request = (async () => {
    const options = { query: term, limit: SEARCH_LIMIT };
    if (type != null && !Number.isNaN(type)) options.type = type;

    const raw = await call("igdb", "search", options);
    const ranked = rankGames(Array.isArray(raw) ? raw : [], term);

    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, ranked);
    last = { query: term, games: ranked };
    return ranked;
  })().finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
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

/**
 * Guards against out-of-order responses: a slow request for "eld" must not
 * overwrite the results for "elden ring". Superseded calls resolve to
 * undefined, which the caller should ignore.
 */
export function latestOnly(fn) {
  let seq = 0;
  return async (...args) => {
    const mine = ++seq;
    const value = await fn(...args);
    return mine === seq ? value : undefined;
  };
}
