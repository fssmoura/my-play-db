// Adapted from public/lab/js/search.js (no typeahead; a type set instead of one
// type; a sequence guard inside; head-start covers kept). The two copies are
// now independent. No DOM.
//
// One IGDB request per query, ranked, with the local `games` cache asked at the
// same moment as a head start. The head start arrives through `onPartial`; the
// returned promise is the real answer, merged by id and ranked.
import { call } from "/js/api.js";
import { rankGames, scoreGame, narrow, mergeById } from "/js/ranking.js";
import {
  searchCached,
  saveSearchResults,
  clearCache as clearGamesCache,
} from "/js/games-cache.js";

export const SEARCH_LIMIT = 200;
export const PAGE_SIZE = 20;
export const DEBOUNCE_MS = 300;

const CACHE_MAX = 60;
const cache = new Map();
// In-flight searches by key, so identical requests share one IGDB call.
const inflight = new Map();
// The last answer, so the next keystroke has something to narrow.
let last = { query: "", key: "", games: [] };
// Bumped by every search() call; older calls resolve to undefined.
let sequence = 0;

export function clearCache() {
  cache.clear();
  inflight.clear();
  clearGamesCache();
  last = { query: "", key: "", games: [] };
}

/** A type selection as a sorted, de-duplicated array of integers. */
export function normalizeTypes(types) {
  return [...new Set((types ?? []).map(Number))]
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

const typesKey = (types) => types.join(",");
const cacheKey = (query, types) => `${query}|${typesKey(types)}`;

function begin(term, types, key) {
  // Never rejects: no head start is a non-event.
  const cached = searchCached(term, types).catch(() => []);
  // `shown` is set once the head start has actually been painted by a caller.
  const entry = { cached, shown: false, games: null };

  entry.games = (async () => {
    const options = { query: term, limit: SEARCH_LIMIT };
    if (types.length) options.type = types;

    const raw = await call("igdb", "search", options);
    const fresh = Array.isArray(raw) ? raw : [];
    const head = await cached;
    // A game we hold keeps the head-start copy's cover (the owner's chosen
    // image, the first entry of its `cover`); IGDB's copy wins for the rest.
    const held = new Map(head.map((game) => [game.id, game]));
    for (const game of fresh) {
      const cover = held.get(game.id)?.cover;
      if (cover) game.cover = cover;
    }
    const merged = mergeById(head, fresh);
    const ranked = entry.shown
      ? rankKeepingShown(merged, head, term)
      : rankGames(merged, term);

    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, ranked);
    return ranked;
  })().finally(() => inflight.delete(key));

  return entry;
}

// Ranks the final list so games the head start already painted keep the order
// they were painted in. Their fresh copy is shown (name, cover...) but scored
// from the head-start copy, via `rankBasis`; ties between two shown games
// follow the head start's order. IGDB-only games slot in by their own score.
function rankKeepingShown(merged, head, term) {
  const shownAt = new Map(head.map((game, index) => [game.id, index]));
  for (const game of merged) {
    const painted = head[shownAt.get(game.id)];
    if (painted && painted !== game) {
      Object.defineProperty(game, "rankBasis", {
        value: painted,
        enumerable: false,
        configurable: true,
      });
    }
  }
  return merged
    .map((game, index) => ({ game, index, score: scoreGame(game, term) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const x = shownAt.get(a.game.id);
      const y = shownAt.get(b.game.id);
      if (x != null && y != null) return x - y;
      return a.index - b.index;
    })
    .map((entry) => entry.game);
}
/**
 * Searches and returns the games ranked best-first, or undefined when a newer
 * search() call has superseded this one (stale responses are dropped, both the
 * head start and the final list).
 *
 * @param {string} query
 * @param {{types?: number[], onPartial?: (games: object[]) => boolean | void}} [opts]
 *   `onPartial` gets locally cached results if they land before IGDB does;
 *   never empty, never after the promise settles. Returning false means it
 *   was not painted (so it doesn't constrain the final ranking).
 */
export async function search(query, opts = {}) {
  const mine = ++sequence;
  const term = String(query ?? "").trim();
  if (!term) return [];

  const types = normalizeTypes(opts.types);
  const key = cacheKey(term, types);

  const hit = cache.get(key);
  if (hit) {
    last = { query: term, key: typesKey(types), games: hit };
    return hit;
  }

  let entry = inflight.get(key);
  if (!entry) {
    entry = begin(term, types, key);
    inflight.set(key, entry);
  }

  let settled = false;
  if (typeof opts.onPartial === "function") {
    entry.cached.then((partial) => {
      if (!settled && mine === sequence && partial.length) {
        if (opts.onPartial(partial) !== false) entry.shown = true;
      }
    });
  }

  let games;
  try {
    games = await entry.games;
  } finally {
    settled = true;
  }
  if (mine !== sequence) return undefined;

  last = { query: term, key: typesKey(types), games };
  // Not awaited: a failed cache write must never fail a search. Only the
  // answer that actually wins is written, not every half-typed query.
  saveSearchResults(games);
  return games;
}

/** Invalidates any search still in flight, e.g. when the field is cleared. */
export function cancelSearch() {
  sequence++;
  // Nothing from before the field was emptied may seed a later narrowing.
  last = { query: "", key: "", games: [] };
}

/**
 * Instant, network-free results for a query that extends the last one (same
 * type set), or null when there is nothing sensible to narrow.
 */
export function narrowLast(query, types = []) {
  if (last.key !== typesKey(normalizeTypes(types))) return null;
  return narrow(last.games, last.query, String(query ?? "").trim());
}

/** Wakes the serverless function and IGDB token. Failures ignored. */
export async function warmUp() {
  try {
    await call("igdb", "auth", {});
  } catch {
    /* ignore */
  }
}
