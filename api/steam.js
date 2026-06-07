const { setCorsHeaders, handlePreflight } = require("./_cors");

const STEAM_API_KEY = process.env.STEAM_API_KEY;

async function steamFetch(interface, method, version, params) {
  const url = new URL(
    `https://api.steampowered.com/${interface}/${method}/v${version}/`,
  );
  url.searchParams.set("key", STEAM_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Steam API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function storeFetch(appids) {
  const ids = Array.isArray(appids) ? appids : [appids];
  const results = await Promise.all(
    ids.map((id) =>
      fetch(`https://store.steampowered.com/api/appdetails?appids=${id}`).then(
        (r) => r.json(),
      ),
    ),
  );
  const merged = {};
  for (const r of results) {
    Object.assign(merged, r);
  }
  return merged;
}

const actions = {
  async profile(options = {}) {
    const steamId = options.steamId;
    if (!steamId) throw new Error("steamId is required");

    return steamFetch("ISteamUser", "GetPlayerSummaries", 2, {
      steamids: steamId,
    });
  },

  async games(options = {}) {
    const steamId = options.steamId;
    if (!steamId) throw new Error("steamId is required");

    return steamFetch("IPlayerService", "GetOwnedGames", 1, {
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
    });
  },

  async recent(options = {}) {
    const steamId = options.steamId;
    if (!steamId) throw new Error("steamId is required");

    const params = { steamid: steamId };
    if (options.count != null) params.count = options.count;
    return steamFetch("IPlayerService", "GetRecentlyPlayedGames", 1, params);
  },

  async game(options = {}) {
    const appids = options.appids;
    if (!appids) throw new Error("appids is required");

    return storeFetch(appids);
  },

  async schemas(options = {}) {
    const appid = options.appid;
    if (!appid) throw new Error("appid is required");

    return steamFetch("ISteamUserStats", "GetSchemaForGame", 2, {
      appid,
    });
  },

  async achievements(options = {}) {
    const steamId = options.steamId;
    const appid = options.appid;
    if (!steamId) throw new Error("steamId is required");
    if (!appid) throw new Error("appid is required");

    return steamFetch("ISteamUserStats", "GetPlayerAchievements", 1, {
      steamid: steamId,
      appid,
    });
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  const raw = req.method === "GET" ? req.query : (req.body ?? {});
  const body = {};
  for (const key of Object.keys(raw)) {
    try {
      body[key] = JSON.parse(raw[key]);
    } catch {
      body[key] = raw[key];
    }
  }
  const { action, options } = body;

  if (!action) return res.status(400).json({ error: "action is required" });

  if (!actions[action])
    return res.status(400).json({ error: `Unknown action: ${action}` });

  try {
    const data = await actions[action](options ?? {});
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
