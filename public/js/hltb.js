/**
 * Finding a game's HowLongToBeat entry, and keeping its times current.
 *
 * The thinking lives in `hltb-match.js`, which is pure. This file does the
 * fetching, decides how many requests are worth spending, and owns the
 * freshness rule.
 *
 * WHY THIS ONE REFRESHES AND THE IGDB CACHE DOES NOT
 *
 * `game.js` re-pulls IGDB every 24 hours because a game's metadata can change
 * meaningfully right up to release. Completion times are the opposite: they are
 * a running average over thousands of submissions, so they move slowly and
 * never jump. A week is generous, and mostly what a refresh buys is a newly
 * released game's times settling down as more people finish it.
 *
 * The SteamGridDB precedent is the other half of this. `sgdb_id` is resolved
 * once and trusted forever. `hltb_id` is the same - once we know which entry a
 * game is, that does not change, and re-searching would only create chances to
 * get it wrong. So a refresh re-reads the TIMES for a known id; it does not
 * re-run the match.
 *
 * WHAT A FAILURE MUST NOT DO
 *
 * This talks to an undocumented endpoint defended by an anti-bot layer. It will
 * break periodically - that is designed for, not hoped against:
 *
 *   - A failed lookup leaves the stored times AND the timestamp alone, so an
 *     outage looks like nothing at all rather than a page that empties out.
 *   - "HLTB has no entry for this game" is a SUCCESS. It stamps the timestamp
 *     with a null id, so it is retried weekly rather than on every page open.
 *   - Nothing here throws at the caller. The worst outcome is no playtimes,
 *     which must render as a blank space, never an error.
 */

import {
  pickBest,
  steamIds,
  steamMatches,
  worthConfirming,
} from "./hltb-match.js";
import { nameVariants } from "./sgdb-match.js";

/**
 * `api.js` and `supabase.js` are imported lazily, everywhere they are used.
 *
 * Both reach for the browser session the moment they load, and the matching
 * logic here is worth being able to run outside a browser - against real HLTB
 * responses, with no database - to check that a DLC does not pick up its base
 * game's times. Eager imports would make that impossible. `sgdb.js` does the
 * same thing for the same reason.
 */
async function db() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

/**
 * How long stored times stay good for.
 *
 * A week. Long enough that a game already on the shelf is effectively never
 * re-fetched, short enough that a game released last month catches up as its
 * sample size grows.
 */
export const HLTB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Ceilings on requests per game, so one awkward title cannot spiral. */
const MAX_NAME_SEARCHES = 2;
const MAX_CONFIRMATIONS = 4;

/** Within one page session, don't even re-read the row. */
const SESSION_TTL_MS = 60 * 1000;

const session = new Map();
const inflight = new Map();

export function clearCache() {
  session.clear();
  inflight.clear();
}

/* ------------------------------------------------------------------ freshness -- */

/** True when HLTB has never been consulted for this row. */
export function isUnchecked(row) {
  return !!row && !row.hltb_synced_at;
}

/** True when it has been consulted, but longer ago than the interval. */
export function isStale(row, now = Date.now()) {
  if (!row?.hltb_synced_at) return false;
  return now - new Date(row.hltb_synced_at).getTime() >= HLTB_TTL_MS;
}

/** True when this row should be looked up now. */
export function needsSync(row, now = Date.now()) {
  return isUnchecked(row) || isStale(row, now);
}

/* -------------------------------------------------------------------- storage -- */

/**
 * The three playtimes worth keeping, in seconds, as HLTB sends them.
 *
 * Main story, main + extras, completionist. Deliberately NOT `comp_all` - it is
 * an average across all three play styles, which is a number nobody plays: it
 * answers "how long does this game take" with a figure that describes no
 * actual way of playing it. The three below each mean something specific.
 *
 * The submission counts are dropped too. They are still used while MATCHING, as
 * a tiebreak between two equally plausible entries, but that happens against
 * live search results - nothing reads them back out of storage.
 */
export function toTimes(record) {
  if (!record) return null;
  const pick = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const times = {
    comp_main: pick(record.comp_main),
    comp_plus: pick(record.comp_plus),
    comp_100: pick(record.comp_100),
  };
  // An entry with no usable time at all is not worth storing as if it were data.
  const hasAny = times.comp_main || times.comp_plus || times.comp_100;
  return hasAny ? times : null;
}

/**
 * Seconds to hours, unrounded. Null stays null.
 *
 * The raw number, for anything that needs to compare or sort. For display use
 * `formatPlaytime()` instead - showing "26.6 hours" implies a precision that an
 * average of thousands of rough self-reported estimates does not have.
 */
export function toHours(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / 3600;
}

/**
 * Seconds as a playtime: "26.5 Hours", "40 Hours".
 *
 * Rounded to the nearest half hour, which is HowLongToBeat's own convention and
 * worth copying for two reasons. It is honest - these are averaged
 * self-reported estimates, and a tenth of an hour is false precision. And it
 * means a figure here can be compared against HLTB's own page at a glance,
 * without wondering whether a small difference is a rounding artefact or a
 * stale record. Verified against HLTB game 53247, which prints 29 / 52 / 75½
 * for the same three numbers this produces.
 *
 * The half is written as ".5" rather than HLTB's "½": the vulgar fraction is
 * one glyph that not every font has, does not select or copy as a number, and
 * reads worse at small sizes.
 *
 * Returns null for a missing time, which callers render as a blank.
 */
export function formatPlaytime(seconds) {
  const hours = toHours(seconds);
  if (hours == null) return null;

  const halves = Math.round(hours * 2);
  // Under half an hour still rounds to something, and "0 Hours" reads as
  // missing data rather than as a very short game.
  return `${Math.max(halves, 1) / 2} Hours`;
}

/** The stored playtimes in display order, labelled. Always all three. */
export const PLAYTIME_FIELDS = [
  ["comp_main", "Main story"],
  ["comp_plus", "Main + extras"],
  ["comp_100", "Completionist"],
];

/**
 * Records what HLTB said. Called only on a SUCCESSFUL lookup, including the
 * successful discovery that HLTB has nothing.
 */
export async function saveHltb(id, { hltbId = null, times = null } = {}) {
  const { error } = await (
    await db()
  )
    .from("games")
    .update({
      hltb_id: hltbId == null ? null : Number(hltbId),
      hltb: times,
      hltb_synced_at: new Date().toISOString(),
    })
    .eq("id", Number(id));
  if (error) throw error;
}

/** Records an id by hand, without touching the times or the timestamp. */
export async function saveHltbId(id, hltbId) {
  const { error } = await (
    await db()
  )
    .from("games")
    .update({
      hltb_id: hltbId == null ? null : Number(hltbId),
      // Force the next read to go and fetch this id's times.
      hltb_synced_at: null,
    })
    .eq("id", Number(id));
  if (error) throw error;
  session.delete(String(Number(id)));
}

/* ------------------------------------------------------------------ resolving -- */

/**
 * The default client. Imported lazily so this module stays loadable outside a
 * browser session, the same way `sgdb.js` does.
 */
function defaultClient() {
  const send = async (action, options) => {
    const { call } = await import("./api.js");
    return call("hltb", action, options);
  };
  return {
    search: (options) => send("search", options),
    game: (options) => send("game", options),
  };
}

/** A resolved match is good enough to stop looking. */
function settled(match) {
  return match && match.confidence === "exact";
}

/**
 * Resolves an IGDB game to an HLTB entry.
 *
 * Two passes over the same search results, cheapest evidence last:
 *
 *   1. Steam id. The plausible candidates are opened one at a time and their
 *      `profile_steam` compared against IGDB's Steam appids. A hit is proof,
 *      and stops everything immediately.
 *   2. Name and year. Only if nothing could be proven.
 *
 * The detail requests in pass one are not wasted when they fail to prove
 * anything: the records they return are richer than the search results, so they
 * are fed back into the name scoring rather than thrown away.
 *
 * Returns null when nothing clears the bar. That is a real answer.
 */
export async function resolveHltb(game, { client } = {}) {
  const api = client ?? defaultClient();
  if (!game?.name) return null;

  const attempts = [];
  const wantSteam = steamIds(game).length > 0;
  const seen = new Map();

  const variants = nameVariants(game).slice(0, MAX_NAME_SEARCHES);
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
      if (result?.game_id == null) continue;
      if (!seen.has(result.game_id)) seen.set(result.game_id, result);
    }

    const pool = [...seen.values()];

    /* ---- pass one: prove it with a Steam id ---- */

    if (wantSteam) {
      for (const candidate of worthConfirming(game, pool, MAX_CONFIRMATIONS)) {
        // Search results never carry profile_steam, so an entry we have
        // already opened is recognisable by having the field at all.
        if ("profile_steam" in candidate && candidate.profile_steam != null) {
          continue;
        }
        let detail = null;
        try {
          detail = await api.game({ hltbId: candidate.game_id });
          attempts.push({
            via: `detail:${candidate.game_id}`,
            steam: detail?.profile_steam ?? null,
          });
        } catch (err) {
          attempts.push({
            via: `detail:${candidate.game_id}`,
            error: err.message,
          });
          continue;
        }
        if (!detail) continue;

        // The detail record supersedes the search stub either way: it carries a
        // precise release date and the Steam id, both of which score better.
        seen.set(detail.game_id, { ...candidate, ...detail });

        if (steamMatches(game, detail)) {
          const match = pickBest(game, [detail], { method: "steam" });
          if (match) return { ...match, attempts };
        }
      }
    }

    /* ---- pass two: name and year ---- */

    best = pickBest(game, [...seen.values()], { method: "name" });
    if (settled(best)) break;
  }

  return best ? { ...best, attempts } : null;
}

/* ----------------------------------------------------------------- the entry -- */

/**
 * Makes sure a game's stored playtimes are current, and returns them.
 *
 * Safe to call on every page open: it reads the row's own timestamp first and
 * usually does nothing. Never throws - a caller should render whatever comes
 * back and show nothing if that is null.
 *
 * @param {object} row a `games` row, as `loadGame` returns it
 * @param {object} [opts]
 * @param {boolean} [opts.force] ignore the weekly interval and fetch anyway
 * @returns {Promise<{times: object|null, hltbId: number|null,
 *   source: "cache"|"hltb", matched: object|null, error: string|null}>}
 */
export async function getPlaytimes(row, opts = {}) {
  const id = Number(row?.id);
  if (!Number.isFinite(id)) {
    return {
      times: null,
      hltbId: null,
      source: "cache",
      matched: null,
      error: null,
    };
  }

  const cached = {
    times: row?.hltb ?? null,
    hltbId: row?.hltb_id ?? null,
    source: "cache",
    matched: null,
    error: null,
  };

  const key = String(id);
  if (opts.force) {
    session.delete(key);
    inflight.delete(key);
  } else {
    const hit = session.get(key);
    if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.value;
    if (!needsSync(row)) return cached;
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        // A known id - resolved before, or set by hand - is trusted and never
        // re-searched. Only its times are re-read.
        let hltbId = row?.hltb_id ?? null;
        let matched = null;
        const api = opts.client ?? defaultClient();

        if (hltbId == null) {
          matched = await resolveHltb(row, { client: api });
          hltbId = matched?.hltbId ?? null;
        }

        if (hltbId == null) {
          // A successful "HLTB does not have this". Stamped so it is retried
          // next week rather than on every page open.
          await saveHltb(id, { hltbId: null, times: null });
          return {
            times: null,
            hltbId: null,
            source: "hltb",
            matched,
            error: null,
          };
        }

        const record = await api.game({ hltbId });
        const times = toTimes(record);
        await saveHltb(id, { hltbId, times });
        return { times, hltbId, source: "hltb", matched, error: null };
      } catch (err) {
        // Keep whatever we already had, and leave the timestamp alone so this
        // is retried on the next page open rather than in a week's time.
        return { ...cached, error: err.message };
      }
    })()
      .then((value) => {
        session.set(key, { value, at: Date.now() });
        return value;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, pending);
  }

  return pending;
}

/** Drops one game from the session cache, forcing the next read to go again. */
export function forget(id) {
  session.delete(String(Number(id)));
}
