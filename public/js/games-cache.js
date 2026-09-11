/**
 * The `games` table used as a head start for search.
 *
 * `games` is a cache of IGDB records - the games we have already looked at -
 * not a library of games owned. It can never answer a search on its own, and
 * it is never meant to: IGDB stays the source of truth. This module only lets
 * a search show something in ~50ms instead of ~600ms for the part of the
 * catalogue we happen to hold already, and grows that catalogue as you search.
 *
 * WHY THE CACHED ROWS CARRY RANKING FIELDS
 *
 * `alternative_names`, `popularity`, `hypes` and `first_release_date` are
 * stored purely so a cached game scores *identically* to the same game coming
 * back from IGDB. That is what makes the second paint invisible: with equal
 * scores, IGDB's results can only be added below, never shuffle what is
 * already on screen. Drop one of those fields from the write and the list
 * starts visibly reordering half a second after every search.
 *
 * FRESHNESS
 *
 * Every committed search rewrites the search-grade columns of the top results
 * it saw, so a cached row is never staler than the last time you searched for
 * that game. Games approaching release - the ones whose data actually moves -
 * are the ones being searched most, so they refresh most, with no cron and no
 * IGDB calls beyond the ones search already makes. The gap: a game searched
 * once and then ignored for weeks keeps its old popularity until it is
 * searched again.
 *
 * RLS grants `authenticated` full access to `games`, so this runs in the
 * browser with no API hop, the same way `vault.js` does.
 */
import { supabase } from "./supabase.js";
import { normalizeName, matchScore, rankGames } from "./ranking.js";

/** Search-grade columns. Deliberately not the detail-only ones. */
const COLUMNS =
  "id, name, slug, summary, game_type, first_release_date, release_dates, " +
  "platforms, cover, alternative_names, popularity, hypes, rating_count";

/** Most rows a cache lookup will pull back before ranking and filtering. */
const LOOKUP_LIMIT = 200;

/** Most rows one committed search writes back. */
export const WRITE_LIMIT = 50;

const lookups = new Map();
const LOOKUP_CACHE_MAX = 60;

export function clearCache() {
  lookups.clear();
}

/* --------------------------------------------------------------- adapters -- */

/**
 * DB row -> the shape IGDB search returns, so one ranker and one card
 * renderer can handle both without knowing where a game came from.
 */
export function fromDbRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    summary: row.summary ?? undefined,
    game_type: row.game_type ?? undefined,
    first_release_date: row.first_release_date ?? undefined,
    release_dates: row.release_dates ?? undefined,
    platforms: row.platforms ?? undefined,
    cover: row.cover?.[0] ? { url: row.cover[0] } : undefined,
    alternative_names: row.alternative_names ?? undefined,
    popularity: row.popularity ?? {},
    hypes: row.hypes ?? undefined,
    total_rating_count: row.rating_count ?? undefined,
  };
}

/**
 * IGDB game -> the payload `cache_search_games` expects.
 *
 * Returns null for anything missing the columns `games` requires, rather than
 * letting the whole batch fail on one odd record.
 */
export function toSearchRow(game) {
  if (!game?.id || !game?.name || !game?.slug) return null;

  const popularity = game.popularity;
  const hasPopularity =
    popularity && typeof popularity === "object"
      ? Object.keys(popularity).length > 0
      : false;

  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    name_normalized: normalizeName(game.name),
    summary: game.summary ?? null,
    game_type: game.game_type ?? null,
    first_release_date: game.first_release_date ?? null,
    platforms: game.platforms ?? null,
    cover: game.cover?.url ?? null,
    alternative_names: game.alternative_names ?? null,
    popularity: hasPopularity ? popularity : null,
    hypes: game.hypes ?? null,
    rating_count: game.total_rating_count ?? null,
  };
}

/* ----------------------------------------------------------------- lookup -- */

/**
 * The word a cached lookup filters on.
 *
 * A whole normalized query can't be used as a substring: "spider man" would
 * have to appear intact, and the stored form of Marvel's Spider-Man is
 * "marvels spider man", which doesn't contain it. So the filter is one word -
 * the longest, as the most selective - and it deliberately over-fetches.
 * Turning candidates into results is `matchScore`'s job, exactly as it is for
 * IGDB's own loose results.
 */
export function lookupTerm(query) {
  const words = normalizeName(query).split(" ").filter(Boolean);
  if (!words.length) return "";
  return words.reduce((best, word) =>
    word.length > best.length ? word : best,
  );
}

/**
 * Cached games matching a query, ranked. Never throws: a cache miss and a
 * cache failure are the same thing to the caller - no head start, wait for
 * IGDB.
 *
 * @param {string} query
 * @param {number|string|null} type optional game_type filter, matching what
 *   the IGDB search would have applied server-side.
 */
export async function searchCached(query, type = null) {
  const term = lookupTerm(query);
  if (!term) return [];

  const wanted = type === "" || type == null ? null : Number(type);
  const key = `${term}|${wanted ?? ""}`;

  let rows = lookups.get(key);
  if (!rows) {
    try {
      let request = supabase
        .from("games")
        .select(COLUMNS)
        .ilike("name_normalized", `%${term}%`)
        .limit(LOOKUP_LIMIT);
      if (wanted != null && !Number.isNaN(wanted)) {
        request = request.eq("game_type", wanted);
      }

      const { data, error } = await request;
      if (error) throw error;
      rows = data ?? [];
    } catch {
      return [];
    }

    if (lookups.size >= LOOKUP_CACHE_MAX) lookups.clear();
    lookups.set(key, rows);
  }

  // `term` is one word of the query, so the rows coming back are candidates,
  // not matches. Score them the same way IGDB's results get scored and drop
  // anything the query doesn't actually match.
  const games = rows
    .map(fromDbRow)
    .filter((game) => game && matchScore(game, query) > 0);

  return rankGames(games, query);
}

/* ------------------------------------------------------- write: search -- */

/**
 * Saves what a committed search returned, so the next search for it has a head
 * start and so the catalogue grows on its own.
 *
 * Fire and forget: this is an optimisation, and a search that worked must not
 * report an error because a cache write didn't. Only committed searches call
 * this - writing on every keystroke would mean a round trip per 150ms of
 * typing, and would fill the table from half-typed queries.
 */
export async function saveSearchResults(games) {
  const payload = (games ?? [])
    .slice(0, WRITE_LIMIT)
    .map(toSearchRow)
    .filter(Boolean);
  if (!payload.length) return 0;

  try {
    const { data, error } = await supabase.rpc("cache_search_games", {
      payload,
    });
    if (error) throw error;
    // What we just wrote is now the freshest thing there is, so stale lookup
    // results must not outlive it.
    lookups.clear();
    return data ?? 0;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------- read/write: one game -- */

/**
 * The whole stored row for one game, exactly as the table holds it.
 *
 * Deliberately not adapted into the IGDB shape the way `fromDbRow` does for
 * search. The detail page's job is to show what the database contains, so it
 * renders the row itself and nothing quietly reinterprets it on the way.
 *
 * Returns null when we hold nothing for that id. Throws on a real failure -
 * unlike the search path, a detail page with no data has nothing to show, so
 * the caller needs to know the difference between "no row" and "lookup broke".
 */
export async function loadGame(id) {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", Number(id))
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/** IGDB involved_companies -> the names on one side of the credit. */
function companyNames(game, role) {
  const names = (game.involved_companies ?? [])
    .filter((entry) => entry?.[role] && entry.company?.name)
    .map((entry) => entry.company.name);
  return names.length ? [...new Set(names)] : null;
}

/** [{url}] -> [url], or null when there is nothing to say. */
function urls(list) {
  const out = (list ?? []).map((item) => item?.url).filter(Boolean);
  return out.length ? out : null;
}

/** An id array as IGDB sends it, or null. Objects are unwrapped to their id. */
function ids(list) {
  const out = (list ?? [])
    .map((item) => (typeof item === "object" ? item?.id : item))
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  return out.length ? out : null;
}

/** A reference that may arrive expanded or as a bare id. */
function refId(value) {
  if (value == null) return null;
  const id = typeof value === "object" ? value.id : value;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

/**
 * IGDB game -> the payload `cache_game_details` expects.
 *
 * `external_games` is folded into the `external_ids` shape the table uses -
 * `{ steam: ["252950"], psn: ["203715"] }` - because a source can legitimately
 * have several uids for one game.
 *
 * Returns null for anything missing the columns `games` requires.
 */
export function toDetailRow(game) {
  if (!game?.id || !game?.name || !game?.slug) return null;

  const externalIds = {};
  for (const entry of game.external_games ?? []) {
    if (!entry?.source || !entry?.uid) continue;
    (externalIds[entry.source] ??= []).push(String(entry.uid));
  }

  const popularity = game.popularity;
  const hasPopularity =
    popularity && typeof popularity === "object"
      ? Object.keys(popularity).length > 0
      : false;

  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    name_normalized: normalizeName(game.name),
    summary: game.summary ?? null,
    storyline: game.storyline ?? null,
    genres: (game.genres ?? []).map((g) => g?.name).filter(Boolean).length
      ? game.genres.map((g) => g.name).filter(Boolean)
      : null,
    cover: game.cover?.url ? [game.cover.url] : null,
    screenshots: urls(game.screenshots),
    artworks: urls(game.artworks),
    developer: companyNames(game, "developer"),
    publisher: companyNames(game, "publisher"),
    game_type: game.game_type ?? null,
    release_dates: game.release_dates ?? null,
    platforms: game.platforms ?? null,
    // `total_rating` is the combined critic-and-user score. See GAME_FIELDS in
    // api/igdb.js for why it must not be the IGDB-users-only `rating`.
    rating: game.total_rating ?? null,
    rating_count: game.total_rating_count ?? null,
    videos: game.videos ?? null,
    websites: game.websites ?? null,
    collections: game.collections ?? null,
    franchises: game.franchises ?? null,
    dlcs: ids(game.dlcs),
    bundles: ids(game.bundles),
    standalone_expansions: ids(game.standalone_expansions),
    remasters: ids(game.remasters),
    remakes: ids(game.remakes),
    expansions: ids(game.expansions),
    expanded_games: ids(game.expanded_games),
    similar_games: ids(game.similar_games),
    parent_game: refId(game.parent_game),
    version_title: game.version_title ?? null,
    version_parent: refId(game.version_parent),
    external_ids: Object.keys(externalIds).length ? externalIds : null,
    // The three fields search ranks on. Written here too, so a detail sync
    // keeps them current instead of letting them drift.
    alternative_names: game.alternative_names ?? null,
    popularity: hasPopularity ? popularity : null,
    hypes: game.hypes ?? null,
    first_release_date: game.first_release_date ?? null,
  };
}

/**
 * Writes one full IGDB record. Unlike the search write-through this is NOT
 * fire and forget: the detail page reads the row straight back afterwards, so
 * a failed write would show stale data while claiming to be fresh.
 */
export async function saveGameDetails(game) {
  const payload = toDetailRow(game);
  if (!payload)
    throw new Error("IGDB returned a game with no id, name or slug");

  const { data, error } = await supabase.rpc("cache_game_details", { payload });
  if (error) throw error;

  // The row just changed, so any cached search lookup holding the old version
  // must not outlive it.
  lookups.clear();
  return data ?? 0;
}
