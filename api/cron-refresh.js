const {
  refreshPlatform,
  REFRESHABLE_PLATFORMS,
} = require("./_platform-refresh");

// Scheduled token refresher. Runs daily via Vercel Cron so platform refresh
// tokens are rolled forward even when nobody opens the app.
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
    const listUrl = `${supabaseUrl}/rest/v1/platform_credentials?select=id,platform,credentials,identity`;
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

      const payload = {
        credentials: result.credentials,
        expires_at: result.expiresAt,
        refresh_expires_at: result.refreshExpiresAt,
      };
      if (result.identity) payload.identity = result.identity;

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
    }
  }

  // Always 200 so Vercel doesn't flag the cron as failing; detail is in the body.
  return res.status(200).json({ ok: true, refreshed, skipped, errors });
};
