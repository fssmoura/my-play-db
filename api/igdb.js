const { setCorsHeaders, handlePreflight } = require("./_cors");

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const IGDB_BASE = "https://api.igdb.com/v4";

const SOURCE_MAP = {
  steam: 1,
  giantbomb: 3,
  gog: 5,
  youtube: 10,
  microsoft: 11,
  apple: 13,
  twitch: 14,
  android: 15,
  amazon: 20,
  amazon_luna: 22,
  amazon_adg: 23,
  epic: 26,
  oculus: 28,
  utomik: 29,
  itch: 30,
  xbox: 31,
  kartridge: 32,
  psn: 36,
  focus: 37,
  xgpc: 54,
  gamejolt: 55,
  igdb: 121,
};

const SOURCE_NAMES = Object.fromEntries(
  Object.entries(SOURCE_MAP).map(([k, v]) => [v, k]),
);

const WEBSITE_TYPES = {
  1: "official",
  2: "wikia",
  3: "wikipedia",
  4: "facebook",
  5: "twitter",
  6: "twitch",
  8: "instagram",
  9: "youtube",
  10: "iphone",
  11: "ipad",
  12: "android",
  13: "steam",
  14: "reddit",
  15: "discord",
  16: "epic",
  17: "gog",
  18: "youtube_channel",
  22: "xbox",
  23: "playstation",
  24: "nintendo",
};

let tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
    method: "POST",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitch auth error: ${res.status} ${text}`);
  }

  const data = await res.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 60000,
  };
  return tokenCache.accessToken;
}

async function igdbFetch(endpoint, query) {
  const token = await getAccessToken();
  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
    body: query,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IGDB error: ${res.status} ${text}`);
  }

  return res.json();
}

function enrichImages(data) {
  const IMG = "https://images.igdb.com/igdb/image/upload/t_1080p";
  if (!data) return;
  if (Array.isArray(data)) {
    data.forEach(enrichImages);
    return;
  }

  if (data.cover?.image_id) {
    data.cover.url = `${IMG}/${data.cover.image_id}.jpg`;
    delete data.cover.id;
    delete data.cover.image_id;
  }
  if (data.artworks) {
    data.artworks.forEach((a) => {
      if (a.image_id) a.url = `${IMG}/${a.image_id}.jpg`;
      delete a.id;
      delete a.image_id;
    });
  }
  if (data.screenshots) {
    data.screenshots.forEach((s) => {
      if (s.image_id) s.url = `${IMG}/${s.image_id}.jpg`;
      delete s.id;
      delete s.image_id;
    });
  }
  if (data.videos) {
    data.videos.forEach((v) => {
      if (v.video_id) v.url = `https://www.youtube.com/watch?v=${v.video_id}`;
      delete v.id;
      delete v.video_id;
    });
  }
  if (data.release_dates) {
    data.release_dates.forEach((r) => delete r.id);
  }
  if (data.websites) {
    data.websites.forEach((w) => {
      delete w.id;
      w.type = WEBSITE_TYPES[w.type] || `type_${w.type}`;
    });
  }
  if (data.external_games) {
    data.external_games.forEach((e) => {
      delete e.id;
      e.source =
        SOURCE_NAMES[e.external_game_source] ||
        `source_${e.external_game_source}`;
      delete e.external_game_source;
    });
  }
}

const actions = {
  async auth() {
    const token = await getAccessToken();
    return { accessToken: token, expiresAt: tokenCache.expiresAt };
  },

  async search(options = {}) {
    const { query, limit = 10 } = options;
    if (!query) throw new Error("query is required");

    const sanitized = query.replace(/"/g, '\\"');
    const typeClause =
      options.type != null ? `; where game_type = ${options.type}` : "";

    const results = await igdbFetch(
      "games",
      `search "${sanitized}"${typeClause}; fields name,slug,summary,game_type,cover.image_id,platforms.name,platforms.abbreviation,release_dates.date,release_dates.platform,release_dates.region,release_dates.human; limit ${limit};`,
    );
    enrichImages(results);
    return results;
  },

  async game(options = {}) {
    const { ids } = options;
    if (!ids) throw new Error("ids is required");

    const idList = Array.isArray(ids) ? ids : [ids];
    const results = await igdbFetch(
      "games",
      `where id = (${idList.join(",")}); fields name,slug,summary,storyline,game_type,version_title,rating,rating_count,updated_at,cover.id,cover.image_id,screenshots.id,screenshots.image_id,artworks.id,artworks.image_id,videos.id,videos.name,videos.video_id,genres.name,platforms.name,platforms.abbreviation,involved_companies.company.id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,bundles,dlcs,expanded_games,expansions,external_games.uid,external_games.external_game_source,remakes,remasters,standalone_expansions,similar_games,collections.name,franchises.name,websites.url,websites.type,version_parent.name,version_parent.slug,version_parent.game_type,parent_game.name,parent_game.slug,parent_game.game_type,release_dates.date,release_dates.platform,release_dates.region,release_dates.human; limit ${idList.length};`,
    );
    enrichImages(results);
    return results;
  },

  async by_external(options = {}) {
    const { source, uid } = options;
    if (!source) throw new Error("source is required");
    if (!uid) throw new Error("uid is required");

    const cat =
      typeof source === "string"
        ? (SOURCE_MAP[source.toLowerCase()] ?? source)
        : source;

    const externalGames = await igdbFetch(
      "external_games",
      `where external_game_source = ${cat} & uid = "${uid}"; fields game, name, url;`,
    );

    if (!externalGames || !externalGames.length) return null;

    const gameId =
      typeof externalGames[0].game === "object"
        ? externalGames[0].game.id
        : externalGames[0].game;

    return { id: gameId };
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
