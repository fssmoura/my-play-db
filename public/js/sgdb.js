// Adapted from public/lab/js/sgdb.js. The two copies are now independent.
// The matching rules (sgdb-match.js) and request budget are unchanged. The one
// difference: a failed request is no longer quietly treated as "no result".
// SteamGridDB answering "not found" is a real answer; the network or the API
// breaking is not, and must never be mistaken for "this game has no match"
// (the caller stores a permanent marker for that).
//
// Fetching only. No database writes, no DOM.

import { bridgeLookups, nameVariants, pickBest } from "/js/sgdb-match.js";

/** Store ids to ask SteamGridDB to hand back, for confirming a match. */
const PLATFORM_DATA = "steam,egs";

/** Ceiling on requests per game, so one bad title cannot spiral. */
const MAX_BRIDGE_LOOKUPS = 4;
const MAX_NAME_SEARCHES = 4;

async function defaultClient() {
  const { call } = await import("/js/api.js");
  return {
    game: (options) => call("sgdb", "game", options),
    search: (options) => call("sgdb", "search", options),
  };
}

/** SteamGridDB's own "no such entry", relayed by api/sgdb.js as a message. */
export function isNotFound(err) {
  return /SGDB error: 404/.test(err?.message ?? "");
}

/**
 * Accepts either an IGDB game (from the `igdb` handler) or a cached `games`
 * row, and returns the one shape the matcher understands.
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

function settled(match) {
  return match && match.confidence === "high" && !match.ambiguous;
}

/**
 * Resolves an IGDB game to a SteamGridDB entry.
 *
 * Returns the match, or null when nothing clears the bar (a real answer).
 * THROWS when a request failed for any reason other than "not found" and no
 * match was found: the answer is then unknown, not "none".
 */
export async function resolveSgdb(game, { client } = {}) {
  const api = client ?? (await defaultClient());
  const input = toMatchInput(game);
  if (!input?.name) return null;

  const attempts = [];
  let failure = null;

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
      attempts.push({
        via: `${lookup.platform}:${lookup.platformId}`,
        error: err.message,
      });
      if (!isNotFound(err)) failure = err;
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
      if (!isNotFound(err)) failure = err;
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

  if (best) return { ...best, attempts };
  if (failure) throw failure;
  return null;
}
