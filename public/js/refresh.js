import { PLATFORMS } from "./platforms.js";
import * as vault from "./vault.js";

/**
 * Keeps stored tokens alive so you don't have to reconnect constantly.
 *
 * Refreshes a platform when its access token has less than SKEW_MS left. Runs
 * on app boot, on a timer, and lazily right before an API console call.
 *
 * Reality check on coverage:
 *   PSN   -> refreshable (short access token, long refresh token)
 *   Epic  -> refreshable (refresh token lasts ~a year)
 *   Xbox  -> refreshable (re-runs the whole MSA -> User -> XSTS chain)
 *   EA    -> NOT refreshable. ORIGIN_JS_SDK has no refresh flow, so EA must be
 *            reconnected by hand roughly every 4 hours. Nothing to be done.
 *   Steam -> never expires.
 *
 * This only runs while the app is open in a tab. A server-side sync job would
 * need its own refresh pass.
 */

const SKEW_MS = 10 * 60 * 1000; // refresh when under 10 minutes remain
const INTERVAL_MS = 4 * 60 * 1000; // re-check every 4 minutes

/** Tracks platforms whose refresh just failed, so we don't hammer them. */
const failed = new Set();

export function isRefreshable(def, record) {
  if (!def?.canRefresh || !record) return false;
  if (def.neverExpires) return false;
  return Boolean(record.credentials?.refreshToken);
}

export function isStale(def, record) {
  if (!isRefreshable(def, record)) return false;
  if (!record.expires_at) return true; // unknown expiry -> assume stale
  return new Date(record.expires_at).getTime() - Date.now() < SKEW_MS;
}

/**
 * Refreshes one platform and persists the result.
 * Returns the saved row, or null if it wasn't refreshable / failed.
 */
export async function refreshOne(id, record) {
  const def = PLATFORMS[id];
  if (!isRefreshable(def, record)) return null;

  const updated = await def.refresh(record);

  // Carry the identity forward - most refresh responses don't include it.
  if (!updated.identity) {
    if (def.identify) {
      try {
        updated.identity = await def.identify(updated);
      } catch {
        updated.identity = record.identity ?? {};
      }
    } else {
      updated.identity = record.identity ?? {};
    }
  }

  const saved = await vault.save(id, updated);
  failed.delete(id);
  return saved;
}

/**
 * Refreshes every stale platform.
 * Returns { refreshed: [...ids], errors: [{ id, message }] }.
 */
export async function refreshStale(records) {
  const refreshed = [];
  const errors = [];

  for (const [id, record] of Object.entries(records)) {
    const def = PLATFORMS[id];
    if (!isStale(def, record) || failed.has(id)) continue;
    try {
      await refreshOne(id, record);
      refreshed.push(id);
    } catch (err) {
      // Usually means the refresh token itself expired -> needs a reconnect.
      failed.add(id);
      errors.push({ id, message: err.message });
    }
  }

  return { refreshed, errors };
}

/** Lazy refresh for a single platform, used right before an API call. */
export async function ensureFresh(id) {
  const record = (await vault.loadAll())[id];
  if (!record) return null;
  if (!isStale(PLATFORMS[id], record)) return record;
  try {
    return (await refreshOne(id, record)) ?? record;
  } catch {
    return record; // let the call fail with the real platform error
  }
}

/** Starts the background timer. Returns a stop function. */
export function startAutoRefresh(getRecords, onRefreshed) {
  const tick = async () => {
    const records = getRecords();
    if (!records || !Object.keys(records).length) return;
    const result = await refreshStale(records);
    if (result.refreshed.length) onRefreshed(result);
  };

  const timer = setInterval(tick, INTERVAL_MS);
  // Also check whenever the tab regains focus after being idle.
  window.addEventListener("focus", tick);

  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
  };
}

/** Clears the failure memo so a reconnected platform resumes auto-refresh. */
export function clearFailure(id) {
  failed.delete(id);
}
