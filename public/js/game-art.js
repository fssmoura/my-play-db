// Game art for the game page, no DOM.
//
//   resolveGameArt(id) -> { banner, cover, logo, status }
//
// banner / cover / logo are the first entry of each stored array (the chosen
// image), or null. status: "ready" (resolved), "none" (SteamGridDB has no
// match for this game) or "error" (something failed; the art is whatever we
// already hold, and nothing permanent was written, so the next open retries).
//
// What it does, in order (only when a game page is opened):
//   1. Read the games row. Missing, or never fully detail-synced and still
//      un-tried on SteamGridDB: pull it from IGDB (cache_game_details) first,
//      which also gives the matcher the store ids it needs.
//   2. games.sgdb_id: null = never tried -> look it up. 0 = tried, nothing
//      found (never retried). >0 = matched.
//   3. Match: fetch the first static grid / hero / logo, write them with the
//      art rule (set_game_art), then store the id. Written last, so a failure
//      part way leaves the id unset and the next open tries again.
//      No match: store 0. Any failure: store nothing.
//   4. >0 but no SteamGridDB image stored in any kind (linked by hand after a
//      "no match"): fetch and write the first images as in 3.
//
// One lookup per game at a time (in-flight map by id).

export const KINDS = {
  cover: "grids",
  banner: "heroes",
  logo: "logos",
};

const IGDB_HOST = "//images.igdb.com/";
const isIgdb = (url) => typeof url === "string" && url.includes(IGDB_HOST);

/**
 * The art rule, mirrored from the SQL function set_game_art: an array is at
 * most [chosen non-IGDB image, IGDB image]. An IGDB image never displaces a
 * non-IGDB one.
 */
export function applyArtRule(existing, url, { asBackup = false } = {}) {
  const list = existing ?? [];
  if (isIgdb(url)) {
    const keep = list.find((x) => !isIgdb(x));
    return keep ? [keep, url] : [url];
  }
  const igdb = list.find((x) => isIgdb(x) && x !== url);
  if (!igdb) return [url];
  return asBackup ? [igdb, url] : [url, igdb];
}

async function defaultDeps() {
  const [cache, { call }] = await Promise.all([
    import("/js/games-cache.js"),
    import("/js/api.js"),
  ]);
  return {
    loadRow: cache.loadGameRow,
    saveDetails: cache.saveGameDetails,
    setArt: cache.setGameArt,
    setSgdbId: cache.setSgdbId,
    pullIgdb: async (id) => {
      const games = await call("igdb", "game", { ids: [Number(id)] });
      return Array.isArray(games) ? games[0] : games;
    },
    // Loaded only when a lookup is actually needed (never for ready rows).
    match: async (game) => (await import("/js/sgdb.js")).resolveSgdb(game),
    // The first static (non-animated) image of a type, or null.
    firstStatic: async (sgdbId, kind) => {
      const res = await call("sgdb", KINDS[kind], {
        sgdbId,
        types: "static",
        nsfw: "false",
        // Grids include wide 460x215 capsules; covers must be portrait 2:3.
        ...(kind === "cover" ? { dimensions: "600x900,342x482,660x930" } : {}),
        limit: 1,
      });
      return res?.data?.[0]?.url ?? null;
    },
  };
}

const inflight = new Map();

export function resolveGameArt(id, deps) {
  const key = String(Number(id));
  let pending = inflight.get(key);
  if (!pending) {
    pending = run(Number(id), deps).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

const first = (row, kind) => row?.[kind]?.[0] ?? null;
const artOf = (row, status) => ({
  banner: first(row, "banner"),
  cover: first(row, "cover"),
  logo: first(row, "logo"),
  status,
});

async function run(id, injected) {
  let d;
  try {
    d = injected ?? (await defaultDeps());
  } catch {
    return artOf(null, "error");
  }

  let row;
  try {
    row = await d.loadRow(id);
  } catch {
    return artOf(null, "error");
  }

  // Linked (by hand, after a "no match") but its first match never pulled.
  if (row?.sgdb_id > 0 && !hasSgdbArt(row)) {
    try {
      return await pullFirst(d, id, row.sgdb_id, row);
    } catch {
      return artOf(row, "error");
    }
  }

  // A lookup that would settle the matter is already recorded.
  const needsLookup = row && row.sgdb_id == null;
  if (row && !needsLookup) return artOf(row, "ready");

  let failed = false;
  let igdbGame = null;

  // Not stored yet, or stored only as a search result: pull the details first.
  if (!row || !row.fully_synced_at) {
    try {
      igdbGame = await d.pullIgdb(id);
      if (igdbGame) {
        await d.saveDetails(igdbGame);
        row = await d.loadRow(id);
      }
    } catch {
      failed = true;
    }
  }
  if (!row) return artOf(null, "error");
  if (failed && !row.external_ids) return artOf(row, "error");
  if (row.sgdb_id != null) return artOf(row, "ready");

  let match;
  try {
    match = await d.match(igdbGame ?? row);
  } catch {
    return artOf(row, "error");
  }

  if (!match) {
    try {
      await d.setSgdbId(id, 0);
    } catch {
      return artOf(row, "error");
    }
    return artOf(row, failed ? "error" : "none");
  }

  // Match: fetch, write the art, then store the id (last, so a failure leaves
  // the game un-tried).
  try {
    const out = await pullFirst(d, id, match.sgdbId, row);
    await d.setSgdbId(id, match.sgdbId);
    return out;
  } catch {
    return artOf(row, "error");
  }
}

// Any non-IGDB image stored means SteamGridDB art was already pulled (or
// chosen), so a hand-linked game is only pulled once.
const hasSgdbArt = (row) =>
  Object.keys(KINDS).some((kind) => row[kind]?.some((url) => !isIgdb(url)));

// Fetch and write the first static image of each kind. Throws on failure.
async function pullFirst(d, id, sgdbId, row) {
  const out = artOf(row, "ready");
  for (const kind of Object.keys(KINDS)) {
    const url = await d.firstStatic(sgdbId, kind);
    if (!url) continue;
    // An automatic cover sits behind IGDB's; banners and logos (IGDB has
    // none) take first place.
    const arr = await d.setArt(id, kind, url, { asBackup: kind === "cover" });
    if (arr?.[0]) out[kind] = arr[0];
  }
  return out;
}
