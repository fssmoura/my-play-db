const { setCorsHeaders, handlePreflight } = require("./_cors");
const { requireUser } = require("./_auth");

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

// IGDB `popularity_types` we care about. There are more (playing, played,
// Steam peak players, Twitch hours watched); these two are the ones that exist
// for both released and unreleased games.
const POPULARITY_TYPES = {
  1: "visits",
  2: "want_to_play",
};

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

/* ------------------------------------------------------------------ cache --
 * In-memory only, so it lives as long as the warm serverless instance does.
 * That is enough to matter: typing "e -> el -> eld -> elden" fires several
 * searches over largely the same games, and every /api/* call is a POST with
 * an Authorization header, which makes it permanently ineligible for Vercel's
 * CDN cache. This is the only caching layer available to us.
 *
 * TTLs are safe because IGDB states PopScore is "updated every 24 hours" and
 * game records change rarely.
 */
const POPULARITY_TTL = 12 * 60 * 60 * 1000;
const SEARCH_TTL = 60 * 60 * 1000;
const GAME_TTL = 12 * 60 * 60 * 1000;
const CACHE_MAX = 500;

const searchCache = new Map();
const popularityCache = new Map();
const gameCache = new Map();

function readCache(cache, key, ttl) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(cache, key, value) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { value, at: Date.now() });
}

/**
 * Popularity for a set of game ids, served from cache where possible.
 * Only the ids we don't already hold are asked for, which is what makes the
 * second, third and fourth keystroke of a search cheap - consecutive queries
 * return largely the same games.
 */
async function popularityFor(ids) {
  const out = {};
  const missing = [];

  for (const id of ids) {
    const hit = readCache(popularityCache, id, POPULARITY_TTL);
    if (hit) out[id] = hit;
    else missing.push(id);
  }

  if (missing.length) {
    const types = Object.keys(POPULARITY_TYPES).join(",");
    let rows = [];
    try {
      rows = await igdbFetch(
        "popularity_primitives",
        `where game_id = (${missing.join(",")}) & popularity_type = (${types}); fields game_id,popularity_type,value; limit 500;`,
      );
    } catch {
      // Popularity is an enrichment - a search that still returns games is far
      // better than one that 500s because this endpoint hiccuped.
      rows = [];
    }

    const fetched = {};
    for (const row of rows) {
      const name = POPULARITY_TYPES[row.popularity_type];
      if (!name) continue;
      fetched[row.game_id] ??= {};
      fetched[row.game_id][name] = row.value;
    }
    // Cache the misses too, so a game with no popularity row isn't re-asked
    // for on every keystroke.
    for (const id of missing) {
      const value = fetched[id] ?? {};
      writeCache(popularityCache, id, value);
      out[id] = value;
    }
  }

  return out;
}

/**
 * The games half of a search, cached separately from popularity so the two can
 * expire on their own schedules.
 *
 * These are all the fields a result card needs plus the two ranking extras, so
 * that one request answers both the typeahead and the full list.
 */
const SEARCH_FIELDS =
  "fields name,slug,summary,game_type,first_release_date,total_rating_count,hypes,alternative_names.name,cover.image_id,platforms.name,platforms.abbreviation";

async function gameSearch({ query, type, limit, offset = 0 }) {
  const key = `${query}|${type ?? ""}|${limit}|${offset}`;
  const cached = readCache(searchCache, key, SEARCH_TTL);
  if (cached) return cached;

  const sanitized = query.replace(/"/g, '\\"');
  const typeClause = type != null ? `; where game_type = ${type}` : "";

  const games = await igdbFetch(
    "games",
    `search "${sanitized}"${typeClause}; ${SEARCH_FIELDS}; limit ${limit}; offset ${offset};`,
  );
  enrichImages(games);

  writeCache(searchCache, key, games);
  return games;
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
    data.release_dates.forEach((r) => {
      delete r.id;
      delete r.human;
      delete r.region;
    });
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

  /**
   * The one search the app uses. Returns everything a result card needs, so a
   * search is a single request - no separate lookup to fill in covers or
   * descriptions afterwards.
   *
   * Two extras beyond the obvious display fields, both there to rank well:
   *
   * - `alternative_names` lets "cod", "tw3" and "botw" be scored properly.
   *   IGDB's search already returns those games, it just ranks them near the
   *   bottom, and their real titles share no words with the query.
   * - `popularity` is fetched from `popularity_primitives` and merged in.
   *   `total_rating_count` is ~0 for anything unreleased and `hypes` is ~0 for
   *   anything released, so neither can order a mixed set on its own. Both are
   *   still returned as a fallback for the ~1 game in 10 with no popularity
   *   row.
   */
  async search(options = {}) {
    const { query, limit = 200, offset = 0 } = options;
    if (!query) throw new Error("query is required");

    const games = await gameSearch({
      query,
      type: options.type,
      limit,
      offset,
    });
    if (!games.length) return [];

    const byGame = await popularityFor(games.map((g) => g.id));
    return games.map((g) => ({ ...g, popularity: byGame[g.id] ?? {} }));
  },

  async game(options = {}) {
    const { ids } = options;
    if (!ids) throw new Error("ids is required");

    const idList = (Array.isArray(ids) ? ids : [ids]).map(Number);
    const out = {};
    const missing = [];

    for (const id of idList) {
      const hit = readCache(gameCache, id, GAME_TTL);
      if (hit) out[id] = hit;
      else missing.push(id);
    }

    if (missing.length) {
      const results = await igdbFetch(
        "games",
        `where id = (${missing.join(",")}); fields name,slug,summary,storyline,game_type,version_title,rating,rating_count,updated_at,cover.id,cover.image_id,screenshots.id,screenshots.image_id,artworks.id,artworks.image_id,videos.id,videos.name,videos.video_id,genres.name,platforms.name,platforms.abbreviation,involved_companies.company.id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,bundles,dlcs,expanded_games,expansions,external_games.uid,external_games.external_game_source,remakes,remasters,standalone_expansions,similar_games,collections.name,franchises.name,websites.url,websites.type,version_parent.name,version_parent.slug,version_parent.game_type,parent_game.name,parent_game.slug,parent_game.game_type,release_dates.date,release_dates.platform,release_dates.region,release_dates.human; limit ${missing.length};`,
      );
      enrichImages(results);
      for (const record of results) {
        writeCache(gameCache, record.id, record);
        out[record.id] = record;
      }
    }

    // Preserve the order asked for; drop ids IGDB didn't return.
    return idList.map((id) => out[id]).filter(Boolean);
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
