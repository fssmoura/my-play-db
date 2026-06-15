const { setCorsHeaders, handlePreflight } = require("./_cors");

const API_KEY = process.env.STEAMGRIDDB_API_KEY;
const BASE = "https://www.steamgriddb.com/api/v2";

async function sgdbFetch(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SGDB error: ${res.status} ${text}`);
  }
  return res.json();
}

const DEFAULT_FILTERS = { nsfw: "any", humor: "any", epilepsy: "any" };

function buildQuery(filters) {
  if (!filters || typeof filters !== "object") return "";
  const merged = { ...DEFAULT_FILTERS };
  for (const [key, val] of Object.entries(filters)) {
    if (val == null) continue;
    merged[key] = Array.isArray(val) ? val.join(",") : val;
  }
  const parts = [];
  for (const [key, val] of Object.entries(merged)) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
  }
  return `?${parts.join("&")}`;
}

const IMAGE_FIELDS = ({ id, width, height, nsfw, humor, mime, url, thumb }) => ({ id, width, height, nsfw, humor, mime, url, thumb });

const actions = {
  async search(options = {}) {
    const { name } = options;
    if (!name) throw new Error("name is required");
    const data = await sgdbFetch(`/search/autocomplete/${encodeURIComponent(name)}`);
    return data.data.map(({ id, name, release_date }) => ({ id, name, release_date }));
  },

  async game(options = {}) {
    const { sgdbId, platform, platformId } = options;
    if (sgdbId) {
      const data = await sgdbFetch(`/games/id/${sgdbId}`);
      return data.data;
    }
    if (platform && platformId) {
      const data = await sgdbFetch(`/games/${platform}/${encodeURIComponent(platformId)}`);
      return data.data;
    }
    throw new Error("sgdbId or { platform, platformId } is required");
  },

  async grids(options = {}) {
    const { sgdbId, platform, platformId, styles, dimensions, mimes, types, nsfw, humor, epilepsy, limit, page } = options;
    const qs = buildQuery({ styles, dimensions, mimes, types, nsfw, humor, epilepsy, limit, page });
    let data;
    if (sgdbId) {
      data = await sgdbFetch(`/grids/game/${sgdbId}${qs}`);
    } else if (platform && platformId) {
      data = await sgdbFetch(`/grids/${platform}/${encodeURIComponent(platformId)}${qs}`);
    } else {
      throw new Error("sgdbId or { platform, platformId } is required");
    }
    data.data = data.data.map(IMAGE_FIELDS);
    return data;
  },

  async heroes(options = {}) {
    const { sgdbId, platform, platformId, styles, dimensions, mimes, types, nsfw, humor, epilepsy, limit, page } = options;
    const qs = buildQuery({ styles, dimensions, mimes, types, nsfw, humor, epilepsy, limit, page });
    let data;
    if (sgdbId) {
      data = await sgdbFetch(`/heroes/game/${sgdbId}${qs}`);
    } else if (platform && platformId) {
      data = await sgdbFetch(`/heroes/${platform}/${encodeURIComponent(platformId)}${qs}`);
    } else {
      throw new Error("sgdbId or { platform, platformId } is required");
    }
    data.data = data.data.map(IMAGE_FIELDS);
    return data;
  },

  async logos(options = {}) {
    const { sgdbId, platform, platformId, styles, mimes, types, nsfw, humor, epilepsy, limit, page } = options;
    const qs = buildQuery({ styles, mimes, types, nsfw, humor, epilepsy, limit, page });
    let data;
    if (sgdbId) {
      data = await sgdbFetch(`/logos/game/${sgdbId}${qs}`);
    } else if (platform && platformId) {
      data = await sgdbFetch(`/logos/${platform}/${encodeURIComponent(platformId)}${qs}`);
    } else {
      throw new Error("sgdbId or { platform, platformId } is required");
    }
    data.data = data.data.map(IMAGE_FIELDS);
    return data;
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
