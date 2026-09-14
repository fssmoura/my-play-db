/**
 * Finding a game's SteamGridDB entry.
 *
 * The thinking lives in `sgdb-match.js`, which is pure. This file only does
 * the fetching and decides how many requests are worth spending.
 *
 * Nothing here writes to the database or touches the DOM. It answers one
 * question - "which SteamGridDB entry is this IGDB game?" - and returns the
 * answer with a confidence attached, so the caller can decide what to trust.
 */

import { bridgeLookups, nameVariants, pickBest } from "./sgdb-match.js";

/** Store ids to ask SteamGridDB to hand back, for confirming a match. */
const PLATFORM_DATA = "steam,egs";

/** Ceiling on requests per game, so one bad title cannot spiral. */
const MAX_BRIDGE_LOOKUPS = 4;
const MAX_NAME_SEARCHES = 4;

/**
 * The default client. Imported lazily because `api.js` reaches for the browser
 * session, and this module needs to stay loadable outside a browser for tests.
 */
async function defaultClient() {
  const { call } = await import("./api.js");
  return {
    game: (options) => call("sgdb", "game", options),
    search: (options) => call("sgdb", "search", options),
  };
}

/**
 * Accepts either an IGDB game (from the `igdb` handler) or a cached `games`
 * row, and returns the one shape the matcher understands.
 *
 * The two differ in how store ids are carried: IGDB gives
 * `external_games: [{ uid, name, source }]`, the database gives
 * `external_ids: { steam: ["252950"] }`. The IGDB form is better, because the
 * store's own name is what separates a game from its multiplayer app.
 */
export function toMatchInput(game) {
  if (!game) return null;

  const external = {};
  if (Array.isArray(game.external_games)) {
    for (const entry of game.external_games) {
      if (!entry?.source || entry.uid == null) continue;
      (external[entry.source] ??= []).push({
        uid: String(entry.uid),
        name: entry.name ?? null,
      });
    }
  } else if (game.external_ids && typeof game.external_ids === "object") {
    for (const [source, ids] of Object.entries(game.external_ids)) {
      external[source] = (ids ?? []).map((uid) => String(uid));
    }
  }

  return {
    id: game.id ?? null,
    name: game.name ?? "",
    alternative_names: (game.alternative_names ?? [])
      .map((alt) => (typeof alt === "string" ? alt : alt?.name))
      .filter(Boolean),
    first_release_date: game.first_release_date ?? null,
    release_dates: game.release_dates ?? [],
    external_ids: external,
  };
}

/** A resolved match is good enough to stop looking. */
function settled(match) {
  return match && match.confidence === "high" && !match.ambiguous;
}

/**
 * Resolves an IGDB game to a SteamGridDB entry.
 *
 * Two passes. Store ids first, because they are exact: SteamGridDB is asked
 * for the entry holding this game's Steam or Epic id, which either exists or
 * does not. Names second, searched under the game's real title and then its
 * known aliases - nothing is trimmed or broadened.
 *
 * Returns null when nothing clears the bar, which is a real answer rather than
 * a failure. SteamGridDB is a community art library, not a catalogue, so a
 * game being absent is ordinary. Handing back the nearest thing instead would
 * put another game's artwork on the page.
 */
export async function resolveSgdb(game, { client } = {}) {
  const api = client ?? (await defaultClient());
  const input = toMatchInput(game);
  if (!input?.name) return null;

  const attempts = [];

  /* ---- pass one: store ids ---- */

  const lookups = bridgeLookups(input).slice(0, MAX_BRIDGE_LOOKUPS);
  const bridged = [];
  for (const lookup of lookups) {
    try {
      const found = await api.game({ ...lookup, platformdata: PLATFORM_DATA });
      attempts.push({
        via: `${lookup.platform}:${lookup.platformId}`,
        hit: Boolean(found),
      });
      if (found?.id != null) bridged.push(found);
    } catch (err) {
      // A store id SteamGridDB has never seen is a 404, which is normal.
      attempts.push({
        via: `${lookup.platform}:${lookup.platformId}`,
        error: err.message,
      });
    }
  }

  if (bridged.length) {
    const match = pickBest(input, bridged, { method: "id" });
    if (match) return { ...match, attempts };
  }

  /* ---- pass two: names ---- */

  const variants = nameVariants(input).slice(0, MAX_NAME_SEARCHES);
  const candidates = [];
  const seen = new Set();
  let best = null;

  for (const variant of variants) {
    let results = [];
    try {
      results = (await api.search({ name: variant.name })) ?? [];
      attempts.push({ via: `search:${variant.name}`, hits: results.length });
    } catch (err) {
      attempts.push({ via: `search:${variant.name}`, error: err.message });
      continue;
    }

    for (const result of results) {
      if (result?.id == null || seen.has(result.id)) continue;
      seen.add(result.id);
      candidates.push(result);
    }

    best = pickBest(input, candidates, { method: "name" });
    if (settled(best)) break;
  }

  return best ? { ...best, attempts } : null;
}
