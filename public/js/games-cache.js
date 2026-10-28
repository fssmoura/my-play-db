// Adapted from public/lab/js/games-cache.js (search lookup and write-back only). The two copies are now independent.
//
// The `games` table is a cache of IGDB records, not a list of games owned. Here
// it is only a head start for search, a place to write results back to, and the
// owner of the chosen cover (the first entry of `cover`). No DOM.
//
// Cached rows carry alternative_names, popularity, hypes and first_release_date
// purely so they score identically to the same game from IGDB; that is what
// stops the list reshuffling when IGDB's answer is merged over the head start.
import { supabase } from "/js/supabase.js";
import { normalizeName, matchScore, rankGames } from "/js/ranking.js";

const COLUMNS =
  "id, name, slug, summary, game_type, first_release_date, release_dates, " +
  "platforms, cover, alternative_names, popularity, hypes, rating_count";

const LOOKUP_LIMIT = 200;
export const WRITE_LIMIT = 50;

const lookups = new Map();
const LOOKUP_CACHE_MAX = 60;

export function clearCache() {
  lookups.clear();
}

/**
 * The whole stored row for a game, or null when we hold nothing. Throws on a
 * real failure, so "no row" and "lookup broke" stay distinct.
 */
export async function loadGameRow(id) {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", Number(id))
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ---- detail write (adapted from public/lab/js/games-cache.js; independent) -- */

function companyNames(game, role) {
  const names = (game.involved_companies ?? [])
    .filter((entry) => entry?.[role] && entry.company?.name)
    .map((entry) => entry.company.name);
  return names.length ? [...new Set(names)] : null;
}

function urls(list) {
  const out = (list ?? []).map((item) => item?.url).filter(Boolean);
  return out.length ? out : null;
}

function ids(list) {
  const out = (list ?? [])
    .map((item) => (typeof item === "object" ? item?.id : item))
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  return out.length ? out : null;
}

function refId(value) {
  if (value == null) return null;
  const id = typeof value === "object" ? value.id : value;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

/** IGDB game -> the payload `cache_game_details` expects (null if unusable). */
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
  const genres = (game.genres ?? []).map((g) => g?.name).filter(Boolean);

  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    name_normalized: normalizeName(game.name),
    summary: game.summary ?? null,
    storyline: game.storyline ?? null,
    genres: genres.length ? genres : null,
    cover: game.cover?.url ? [game.cover.url] : null,
    screenshots: urls(game.screenshots),
    artworks: urls(game.artworks),
    developer: companyNames(game, "developer"),
    publisher: companyNames(game, "publisher"),
    game_type: game.game_type ?? null,
    release_dates: game.release_dates ?? null,
    platforms: game.platforms ?? null,
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
    alternative_names: game.alternative_names ?? null,
    popularity: hasPopularity ? popularity : null,
    hypes: game.hypes ?? null,
    first_release_date: game.first_release_date ?? null,
  };
}

/** Writes one full IGDB record (cache_game_details). Throws on failure. */
export async function saveGameDetails(game) {
  const payload = toDetailRow(game);
  if (!payload) throw new Error("IGDB returned a game with no id, name or slug");
  const { data, error } = await supabase.rpc("cache_game_details", { payload });
  if (error) throw error;
  lookups.clear();
  return data ?? 0;
}

/**
 * Art rule (new app): a cover/banner/logo array is at most [chosen non-IGDB
 * image, IGDB image]. `set_game_art` (SQL) builds it; returns the new array,
 * or null when the game has no row. Throws on failure.
 */
export async function setGameArt(id, kind, url, { asBackup = false } = {}) {
  const { data, error } = await supabase.rpc("set_game_art", {
    game_id: Number(id),
    kind,
    url,
    as_backup: asBackup,
  });
  if (error) throw error;
  lookups.clear();
  return data ?? null;
}

/** sgdb_id: null never tried, 0 tried and nothing found, >0 matched. Throws. */
export async function setSgdbId(id, value) {
  const { error } = await supabase.rpc("set_sgdb_id", {
    game_id: Number(id),
    value: Number(value),
  });
  if (error) throw error;
}

/** DB row -> the shape IGDB search returns. */
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

/** IGDB game -> the payload `cache_search_games` expects (null if unusable). */
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

/** The longest word of the query: the most selective single ilike filter. */
export function lookupTerm(query) {
  const words = normalizeName(query).split(" ").filter(Boolean);
  if (!words.length) return "";
  return words.reduce((best, word) =>
    word.length > best.length ? word : best,
  );
}

/**
 * Cached games matching a query, ranked. Never throws: a miss and a failure
 * both mean "no head start".
 *
 * @param {string} query
 * @param {number[]} types game_type set; empty means no filter.
 */
export async function searchCached(query, types = []) {
  const term = lookupTerm(query);
  if (!term) return [];

  const set = [...new Set(types)].sort((a, b) => a - b);
  const key = `${term}|${set.join(",")}`;

  let rows = lookups.get(key);
  if (!rows) {
    try {
      let request = supabase
        .from("games")
        .select(COLUMNS)
        .ilike("name_normalized", `%${term}%`)
        .limit(LOOKUP_LIMIT);
      if (set.length) request = request.in("game_type", set);

      const { data, error } = await request;
      if (error) throw error;
      rows = data ?? [];
    } catch {
      return [];
    }

    if (lookups.size >= LOOKUP_CACHE_MAX) lookups.clear();
    lookups.set(key, rows);
  }

  const games = rows
    .map(fromDbRow)
    .filter((game) => game && matchScore(game, query) > 0);

  return rankGames(games, query);
}

/**
 * Writes the top results back so the catalogue grows. Fire and forget: a
 * failed write never fails a search.
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
    lookups.clear();
    return data ?? 0;
  } catch {
    return 0;
  }
}
