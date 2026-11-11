// Loads one Steam game's full achievement list into `achievements`. Server-side
// only (service role). Shared by the one-off import and the updater.
//
// Official API: names, icons, visible descriptions, unlocks, rarity.
// Public profile page: hidden descriptions and group names, which the official
// API never gives. The page is unofficial and rate-limits, so it is optional:
// if it fails, everything else is still saved and stored text is never wiped.

const PAGE_URL = (steamId, appid) =>
  `https://steamcommunity.com/profiles/${steamId}/stats/${appid}/achievements/?l=english`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function steamApi(iface, method, version, params) {
  const url = new URL(
    `https://api.steampowered.com/${iface}/${method}/v${version}/`,
  );
  url.searchParams.set("key", process.env.STEAM_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Steam ${method} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * The player's unlocks as Map(api_name -> unlock time, 0 if locked), or null
 * when Steam refuses (403). That happens for games no longer on the account,
 * like a free weekend or a removed free game: Steam hides the progress
 * everywhere, profile page included. Any other failure throws.
 */
async function playerUnlocks(steamId, appid) {
  let player;
  try {
    player = await steamApi("ISteamUserStats", "GetPlayerAchievements", 1, {
      steamid: steamId,
      appid,
    });
  } catch (err) {
    if (err.status === 403) return null;
    throw err;
  }
  if (!player?.playerstats?.success)
    throw new Error("Steam GetPlayerAchievements failed");
  return new Map(
    (player.playerstats.achievements ?? []).map((a) => [
      a.apiname,
      a.achieved ? a.unlocktime : 0,
    ]),
  );
}

/**
 * api_name -> { description, group } from the page. Empty when Steam has no
 * achievements page for the game at all (it redirects to the profile, as for
 * Spacewar), so callers don't keep retrying a page that will never exist.
 * Throws on anything that might be temporary.
 */
async function fetchPage(steamId, appid) {
  const res = await fetch(PAGE_URL(steamId, appid));
  if (!res.ok) throw new Error(`page ${res.status}`);
  if (!new URL(res.url).pathname.includes("/achievements")) return new Map();
  const html = await res.text();
  const tag = html.indexOf('id="valve-ssr-data"');
  if (tag < 0) throw new Error("page has no data");
  const start = html.indexOf(">", tag) + 1;
  const ssr = JSON.parse(html.slice(start, html.indexOf("</script>", start)));
  const queries = JSON.parse(ssr.renderContext.queryData).queries;
  const schema = queries.find(
    (q) =>
      q.queryKey?.[0] === "achievements" && q.queryKey?.[2] === "schema_v2",
  )?.state?.data;
  if (!Array.isArray(schema?.groups)) throw new Error("page has no schema");

  const out = new Map();
  // A single group is just the whole list, so it gets no name.
  const grouped =
    schema.groups.filter((g) => g.achievements?.length).length > 1;
  for (const group of schema.groups) {
    for (const a of group.achievements ?? []) {
      out.set(a.api_name, {
        description: a.description || null,
        group: grouped ? group.name || null : null,
      });
    }
  }
  return out;
}

async function fetchPageWithRetry(steamId, appid, retryDelays) {
  for (let i = 0; ; i++) {
    try {
      return await fetchPage(steamId, appid);
    } catch (err) {
      if (i >= retryDelays.length) return null;
      await wait(retryDelays[i]);
    }
  }
}

/**
 * options: { db, ownedGameId, appid, steamId, retryDelays = [] }
 * Returns { total, unlocked, secret, secretMissingText, pageOk, progressHidden }.
 * progressHidden: Steam won't share this player's progress (see
 * playerUnlocks); the list is still saved and existing unlocks kept.
 * Throws if the official data can't be read, so a caller never saves a
 * half-read game (which could wipe unlocks).
 */
async function loadSteamAchievements({
  db,
  ownedGameId,
  appid,
  steamId,
  retryDelays = [],
}) {
  const schema = await steamApi("ISteamUserStats", "GetSchemaForGame", 2, {
    appid,
    l: "english",
  });
  const defs = schema?.game?.availableGameStats?.achievements ?? [];
  if (!defs.length) {
    return {
      total: 0,
      unlocked: 0,
      secret: 0,
      secretMissingText: 0,
      pageOk: true,
      progressHidden: false,
    };
  }

  const found = await playerUnlocks(steamId, appid);
  const progressHidden = !found;
  const unlocks = found ?? new Map();

  let rarity = new Map();
  try {
    const pct = await steamApi(
      "ISteamUserStats",
      "GetGlobalAchievementPercentagesForApp",
      2,
      {
        gameid: appid,
      },
    );
    rarity = new Map(
      (pct?.achievementpercentages?.achievements ?? []).map((a) => [
        a.name,
        Number(a.percent),
      ]),
    );
  } catch {
    // Rarity is optional; existing values are kept below.
  }

  // The page is the player's profile, so it shows nothing when progress is
  // hidden; skip the slow read.
  const page = progressHidden
    ? null
    : await fetchPageWithRetry(steamId, appid, retryDelays);

  const existing = new Map(
    (
      await db.select(
        "achievements",
        `owned_game_id=eq.${ownedGameId}&select=platform_key,description,group_name,rarity,unlocked_at`,
      )
    ).map((r) => [r.platform_key, r]),
  );

  let unlocked = 0;
  let secret = 0;
  let secretMissingText = 0;
  const rows = defs.map((d) => {
    const old = existing.get(d.name);
    const fromPage = page?.get(d.name);
    const unlockTime = unlocks.get(d.name);
    const unlockedAt = unlockTime
      ? new Date(unlockTime * 1000).toISOString()
      : (old?.unlocked_at ?? null);
    const pct = rarity.get(d.name);
    const row = {
      owned_game_id: ownedGameId,
      platform_key: d.name,
      group_name: page ? (fromPage?.group ?? null) : (old?.group_name ?? null),
      name: d.displayName || d.name,
      description:
        fromPage?.description || d.description || old?.description || null,
      icon: d.icon || null,
      rarity: Number.isFinite(pct)
        ? Math.round(pct * 100) / 100
        : (old?.rarity ?? null),
      tier: null,
      points: null,
      secret: d.hidden === 1,
      unlocked_at: unlockedAt,
    };
    if (row.unlocked_at) unlocked++;
    if (row.secret) {
      secret++;
      if (!row.description) secretMissingText++;
    }
    return row;
  });

  await db.upsert("achievements", "owned_game_id,platform_key", rows);
  return {
    total: rows.length,
    unlocked,
    secret,
    secretMissingText,
    pageOk: !!page,
    progressHidden,
  };
}

const ROW_COLUMNS =
  "owned_game_id,platform_key,group_name,name,description,icon,rarity,tier,points,secret,unlocked_at";

/**
 * The cheap path for a game that was played and is already loaded: one call
 * for unlocks (which also lists every achievement the game has) and one for
 * rarity. No page read. If Steam lists an achievement we don't have, the
 * game changed (update or add-on) and the full load runs instead.
 *
 * Returns { newUnlocks, fullLoad, progressHidden } where fullLoad is the
 * loader's result when it ran, else null.
 */
async function refreshSteamUnlocks({
  db,
  ownedGameId,
  appid,
  steamId,
  retryDelays = [],
}) {
  const unlocks = await playerUnlocks(steamId, appid);
  if (!unlocks) return { newUnlocks: 0, fullLoad: null, progressHidden: true };

  const existing = await db.select(
    "achievements",
    `owned_game_id=eq.${ownedGameId}&select=${ROW_COLUMNS}`,
  );
  const known = new Map(existing.map((r) => [r.platform_key, r]));

  if ([...unlocks.keys()].some((key) => !known.has(key))) {
    const fullLoad = await loadSteamAchievements({
      db,
      ownedGameId,
      appid,
      steamId,
      retryDelays,
    });
    return {
      newUnlocks: null,
      fullLoad,
      progressHidden: fullLoad.progressHidden,
    };
  }

  let rarity = new Map();
  try {
    const pct = await steamApi(
      "ISteamUserStats",
      "GetGlobalAchievementPercentagesForApp",
      2,
      {
        gameid: appid,
      },
    );
    rarity = new Map(
      (pct?.achievementpercentages?.achievements ?? []).map((a) => [
        a.name,
        Number(a.percent),
      ]),
    );
  } catch {
    // Rarity is optional; unlocks still get saved.
  }

  let newUnlocks = 0;
  const changed = [];
  for (const [key, unlockTime] of unlocks) {
    const row = known.get(key);
    const next = { ...row };
    if (unlockTime && !row.unlocked_at) {
      next.unlocked_at = new Date(unlockTime * 1000).toISOString();
      newUnlocks++;
    }
    const pct = rarity.get(key);
    if (Number.isFinite(pct)) next.rarity = Math.round(pct * 100) / 100;
    if (
      next.unlocked_at !== row.unlocked_at ||
      Number(next.rarity) !== Number(row.rarity)
    ) {
      changed.push(next);
    }
  }
  if (changed.length)
    await db.upsert("achievements", "owned_game_id,platform_key", changed);
  return { newUnlocks, fullLoad: null, progressHidden: false };
}

module.exports = { loadSteamAchievements, refreshSteamUnlocks };
