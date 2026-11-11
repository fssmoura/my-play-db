const { setCorsHeaders, handlePreflight } = require("./_cors");
const { requireUser } = require("./_auth");

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
      // Without this Steam leaves out games it hasn't reviewed yet (small
      // free games, mostly).
      skip_unvetted_apps: "0",
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

  // Undocumented: last-played time and playtime for every app the API key's
  // own account has ever launched, including free games GetOwnedGames leaves
  // out. Gives app ids only, no names.
  async last_played() {
    return steamFetch("IPlayerService", "ClientGetLastPlayedTimes", 1, {});
  },

  // Name and type for any app id, even ones without a store page. type 0 is
  // a game; 1 demo, 6 software, 14 tool and so on.
  async store_items(options = {}) {
    const appids = options.appids;
    if (!appids?.length) throw new Error("appids is required");

    return steamFetch("IStoreBrowseService", "GetItems", 1, {
      input_json: JSON.stringify({
        ids: appids.map((appid) => ({ appid: Number(appid) })),
        context: { language: "english", country_code: "US" },
        data_request: { include_basic_info: true },
      }),
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

  async openid_verify(options = {}) {
    const params = options.params;
    if (!params) throw new Error("params is required");

    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith("openid.")) continue;
      if (k === "openid.mode") continue;
      form.set(k, v);
    }
    form.set("openid.mode", "check_authentication");

    const res = await fetch("https://steamcommunity.com/openid/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(`Steam API error: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    if (!/is_valid\s*:\s*true/i.test(text)) {
      throw new Error("Steam OpenID verification failed");
    }

    const claimedId = params["openid.claimed_id"] ?? "";
    const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
      claimedId,
    );
    if (!match) {
      throw new Error("Could not parse SteamID from OpenID response");
    }
    const steamId = match[1];

    const summary = await steamFetch("ISteamUser", "GetPlayerSummaries", 2, {
      steamids: steamId,
    });

    return { steamId, profile: summary?.response?.players?.[0] ?? null };
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

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

// For other server code (the matcher) to call actions without an HTTP hop.
module.exports.actions = actions;
