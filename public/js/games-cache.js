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
