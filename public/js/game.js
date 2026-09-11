/**
 * One game, fetched once a day at most.
 *
 * WHY A PLAIN TIMER, AND NOT SOMETHING CLEVERER
 *
 * IGDB publishes an `updated_at` on every game, and a `checksum`. Both look
 * like they should answer "has this changed since we last looked?", and
 * neither does. Measured against this project's own 1,578 cached games:
 *
 *   - 76% had `updated_at` move within 24 hours, 96% within 30 days -
 *     including games from 2011-2015 that nobody has edited in a decade.
 *   - Comparing 40 of those stored rows against IGDB field by field found
 *     ZERO differences. Name, release date, cover, rating count, summary: all
 *     identical, despite most being flagged as "updated" that same day.
 *   - `checksum` moves in lockstep with `updated_at`, so it is no better.
 *
 * IGDB is touching records for its own housekeeping, not because the content
 * changed. So there is no signal to subscribe to, poll, or compare - which is
 * also why there is no cron job and no webhook here. A timer is not the lazy
 * option, it is the only honest one.
 *
 * That measurement also shows the data barely moves, so a day is generous.
 *
 * THE COST OF GETTING IT WRONG IS LOW
 *
 * IGDB allows 4 requests a second with no monthly quota, and a page open costs
 * two. The interval exists to keep the page instant and avoid pointless work,
 * not to stay inside a budget.
 */
import { call } from "./api.js";
import { loadGame, saveGameDetails } from "./games-cache.js";

/**
 * How long a full sync stays good for. One day, so a game approaching release
 * is never more than a day behind.
 *
 * Deliberately a duration rather than "same calendar day": a game pulled at
 * 23:55 should not be re-pulled ten minutes later.
 */
export const FULL_SYNC_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Within one page session, don't even re-read the row. Covers flicking between
 * tabs and back; a browser refresh clears it and falls through to the row's
 * own timestamp, which is the real guard.
 */
const SESSION_TTL_MS = 60 * 1000;

const session = new Map();
const inflight = new Map();

export function clearCache() {
  session.clear();
  inflight.clear();
}

/** True when the stored row has never had a full detail sync. */
export function isSearchOnly(row) {
  return !!row && !row.fully_synced_at;
}

/** True when a full sync has happened but has aged out. */
export function isStale(row, now = Date.now()) {
  if (!row?.fully_synced_at) return false;
  return now - new Date(row.fully_synced_at).getTime() >= FULL_SYNC_TTL_MS;
}

/** Pulls the full record from IGDB, writes it, and returns the stored row. */
async function pull(id) {
  const games = await call("igdb", "game", { ids: [Number(id)] });
  const game = Array.isArray(games) ? games[0] : games;
  if (!game) return null;

  await saveGameDetails(game);

  // Read back rather than returning what IGDB sent. The page's job is to show
  // what the database holds, and this proves the write landed.
  return loadGame(id);
}

/**
 * The stored row for a game, pulling from IGDB when we have to.
 *
 * Three outcomes, and only one of them waits on the network:
 *
 *   - synced within the last day  -> returned straight from the database
 *   - synced longer ago than that -> re-pulled, written, returned
 *   - only a search row, or none  -> pulled before returning, so the page is
 *                                    never rendered half-empty
 *
 * @param {number|string} id
 * @param {object} [opts]
 * @param {boolean} [opts.force] ignore both caches and the daily interval and
 *   pull from IGDB regardless. Note the serverless function keeps its own
 *   12-hour cache, so this forces a re-read, not necessarily a re-fetch.
 * @returns {Promise<{row: object, source: "cache"|"igdb", stale: boolean}>}
 *   `stale` means IGDB could not be reached and this row is older than the
 *   interval - the page has something to show, but should say so.
 */
export async function getGame(id, opts = {}) {
  const key = String(Number(id));
  if (!Number.isFinite(Number(id))) throw new Error(`Not a game id: ${id}`);

  if (opts.force) {
    session.delete(key);
    inflight.delete(key);
  }

  const hit = session.get(key);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.value;

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const row = await loadGame(key);

      if (!opts.force && row && !isSearchOnly(row) && !isStale(row)) {
        return { row, source: "cache", stale: false };
      }

      try {
        const fresh = await pull(key);
        if (fresh) return { row: fresh, source: "igdb", stale: false };
        if (row) return { row, source: "cache", stale: true };
        throw new Error(`IGDB has no game with id ${key}.`);
      } catch (error) {
        // A row we already fully synced is still worth showing when IGDB is
        // unreachable. A search-only row is not - it would be a half-empty
        // page pretending to be a full one.
        if (row && !isSearchOnly(row)) {
          return { row, source: "cache", stale: true };
        }
        throw error;
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
