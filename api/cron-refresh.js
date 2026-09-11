const {
  refreshPlatform,
  REFRESHABLE_PLATFORMS,
} = require("./_platform-refresh");

// How long a cached game survives without being seen in a search.
const CACHE_MAX_AGE = "90 days";

// Scheduled maintenance. Runs daily via Vercel Cron so platform refresh tokens
// are rolled forward even when nobody opens the app, and so the search cache
// cannot grow without limit.
// Never logs or returns token values - platform names and messages only.
module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: "CRON_SECRET is not configured" });
  }
  const authHeader = req.headers?.authorization || "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res
      .status(500)
      .json({ error: "supabase service credentials are not configured" });
  }

  const restHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  let rows;
  try {
    const listUrl = `${supabaseUrl}/rest/v1/platform_credentials?select=id,platform,credentials`;
    const response = await fetch(listUrl, { headers: restHeaders });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`supabase read failed: ${response.status} ${detail}`);
    }
    rows = await response.json();
  } catch (err) {
    console.error("cron-refresh: could not read credentials:", err.message);
    return res.status(500).json({ error: err.message });
  }

  const refreshed = [];
  const skipped = [];
  const errors = [];

  for (const row of rows) {
    const platform = row.platform;
    const credentials = row.credentials || {};

    if (
      !REFRESHABLE_PLATFORMS.includes(platform) ||
      !credentials.refreshToken
    ) {
      skipped.push(platform);
      continue;
    }

    try {
      const result = await refreshPlatform(platform, credentials);

      // Access only. `identity` is a connect-time snapshot and profile data
      // belongs in its own table, so this job never touches either.
      const payload = {
        credentials: result.credentials,
        expires_at: result.expiresAt,
        refresh_expires_at: result.refreshExpiresAt,
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
      };

      const patchUrl = `${supabaseUrl}/rest/v1/platform_credentials?id=eq.${encodeURIComponent(row.id)}`;
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          ...restHeaders,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });
      if (!patchRes.ok) {
        const detail = await patchRes.text();
        throw new Error(`supabase write failed: ${patchRes.status} ${detail}`);
      }

      refreshed.push(platform);
      console.log(`cron-refresh: refreshed ${platform}`);
    } catch (err) {
      errors.push({ platform, message: err.message });
      console.error(`cron-refresh: ${platform} failed: ${err.message}`);
      // Persist the failure so a silently dying integration is visible in the
      // app instead of only surfacing when the token finally lapses.
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/platform_credentials?id=eq.${encodeURIComponent(row.id)}`,
          {
            method: "PATCH",
            headers: {
              ...restHeaders,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ last_refresh_error: err.message }),
          },
        );
      } catch {
        /* best effort - never let bookkeeping mask the real error */
      }
    }
  }

  // Retention for the search cache. `games` grows with what gets searched
  // rather than with what you have, so it is the only table here without a
  // natural ceiling. Anything untouched for CACHE_MAX_AGE and with no
  // player_games row is dropped; see prune_games_cache() for the reasoning.
  //
  // Runs after the refresh loop and never affects it: token refreshes are the
  // job that actually matters, and housekeeping failing must not look like
  // them failing.
  let pruned = null;
  try {
    const pruneRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/prune_games_cache`,
      {
        method: "POST",
        headers: { ...restHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ max_age: CACHE_MAX_AGE }),
      },
    );
    if (!pruneRes.ok) {
      const detail = await pruneRes.text();
      throw new Error(`${pruneRes.status} ${detail}`);
    }
    pruned = await pruneRes.json();
    console.log(`cron-refresh: pruned ${pruned} cached game(s)`);
  } catch (err) {
    errors.push({ task: "prune_games_cache", message: err.message });
    console.error(`cron-refresh: prune failed: ${err.message}`);
  }

  // Always 200 so Vercel doesn't flag the cron as failing; detail is in the body.
  return res.status(200).json({ ok: true, refreshed, skipped, pruned, errors });
};
