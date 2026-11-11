// The Steam updater. Server-side only (service role). Called by
// api/library-sync.js; safe to run as often as wanted, because it only fetches
// what changed. See docs/database.md#the-steam-updater.

const steam = require("./steam");
const { matchPlatform } = require("./_match");
const {
  loadSteamAchievements,
  refreshSteamUnlocks,
} = require("./_steam-achievements");

const PAGE_PAUSE_MS = 3000;
const STORE_TYPE_GAME = 0;
const STORE_TYPES = { 1: "demo", 6: "software", 14: "tool" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const seconds = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);
const iso = (secs) => (secs ? new Date(secs * 1000).toISOString() : null);

async function hasAchievements(appid) {
  const schema = await steam.actions.schemas({ appid });
  return (schema?.game?.availableGameStats?.achievements?.length ?? 0) > 0;
}

/**
 * Everything Steam knows about the games played on this account, from three
 * lists, as Map(appid -> { appid, name, playtime (s), lastPlayed (s, null =
 * unknown), hasStats (null = unknown), listed }).
 *
 * - Owned games: the main list, with everything. Required.
 * - Last-played times: every app ever launched, including free games the
 *   owned list leaves out for good (GeoGuessr, Dota 2...). No names.
 * - Recently played: has names, and catches a just-played game even if the
 *   list above fails.
 * The last two are optional; if either fails the updater carries on.
 */
async function readSteam(steamId) {
  const [owned, lastTimes, recent] = await Promise.allSettled([
    steam.actions.games({ steamId }),
    steam.actions.last_played(),
    steam.actions.recent({ steamId }),
  ]);
  const games =
    owned.status === "fulfilled" ? owned.value?.response?.games : null;
  // An empty answer means a private profile or a Steam hiccup, never "you own
  // nothing", so stop rather than act on it.
  if (!Array.isArray(games) || !games.length) {
    throw new Error("Steam returned no games (profile private or Steam down)");
  }

  const info = new Map();
  for (const g of games) {
    info.set(String(g.appid), {
      appid: g.appid,
      name: g.name,
      playtime: (g.playtime_forever ?? 0) * 60,
      lastPlayed: g.rtime_last_played ?? 0,
      hasStats: !!g.has_community_visible_stats,
      listed: true,
    });
  }
  const unlisted = (appid) => {
    const key = String(appid);
    if (info.get(key)?.listed) return null;
    if (!info.has(key)) {
      info.set(key, {
        appid: Number(appid),
        name: null,
        playtime: 0,
        lastPlayed: null,
        hasStats: null,
        listed: false,
      });
    }
    return info.get(key);
  };
  if (lastTimes.status === "fulfilled") {
    for (const g of lastTimes.value?.response?.games ?? []) {
      const e = unlisted(g.appid);
      if (!e) continue;
      e.playtime = (g.playtime_forever ?? 0) * 60;
      e.lastPlayed = g.last_playtime ?? 0;
    }
  }
  if (recent.status === "fulfilled") {
    for (const g of recent.value?.response?.games ?? []) {
      const e = unlisted(g.appid);
      if (!e) continue;
      e.name = g.name;
      e.playtime = Math.max(e.playtime, (g.playtime_forever ?? 0) * 60);
    }
  }
  return info;
}

/**
 * options: { db, steamId, deadline (ms epoch), log(message) }
 * Returns a summary. Throws only when Steam's owned list can't be read.
 *
 * A game's playtime is saved only after its achievements succeed, so anything
 * that fails or runs out of time still looks "changed" next run and is
 * picked up again. Nothing is ever deleted.
 */
async function updateSteam({
  db,
  steamId,
  deadline = Infinity,
  log = () => {},
}) {
  const report = {
    new_games: [],
    updated: 0,
    new_unlocks: 0,
    full_loads: 0,
    match: null,
    failed: [],
    unfinished: 0,
  };

  log("Checking Steam lists...");
  const info = await readSteam(steamId);

  const [rows, ignoredRows, missingText] = await Promise.all([
    db.select(
      "player_games",
      "version=eq.steam&select=id,igdb_id,playtime,last_played,meta,achievements(count)",
    ),
    db.select("ignored_games", "platform=eq.steam&select=external_id"),
    db.select(
      "achievements",
      "secret=is.true&description=is.null&select=owned_game_id",
    ),
  ]);
  const byApp = new Map(rows.map((r) => [String(r.meta?.appid), r]));
  const ignored = new Set(ignoredRows.map((r) => String(r.external_id)));
  // Games whose list is missing or still lacks secret text get a full load.
  // Not when progress is hidden: the text comes from the profile page, which
  // shows nothing for those, so retrying would never finish. Nor when the
  // page was read fine and simply has no text for some (placeholder
  // achievements); retrying those would never finish either.
  const hidden = new Set(
    rows
      .filter((r) => r.meta?.progress_hidden || r.meta?.secret_text_unavailable)
      .map((r) => r.id),
  );
  const needsFullLoad = new Set(
    missingText.map((r) => r.owned_game_id).filter((id) => !hidden.has(id)),
  );
  for (const r of rows) {
    // no_achievements: Steam stats but zero achievements (loaded and found
    // none), so the empty list is the answer, not a gap to fill.
    if (
      r.meta?.has_stats &&
      !r.meta?.no_achievements &&
      !(r.achievements?.[0]?.count > 0)
    ) {
      needsFullLoad.add(r.id);
    }
  }

  /* New games. */
  const candidates = [...info.values()].filter(
    (e) => !byApp.has(String(e.appid)) && !ignored.has(String(e.appid)),
  );
  // Apps missing from the owned list include demos, tools, software and test
  // builds. All are added - only the owner decides what to ignore - but
  // anything that isn't a game is labelled in meta.store_type so it's easy to
  // spot. If the store can't be reached they wait for the next run rather
  // than being added without a name or label.
  const unlistedNew = candidates.filter((e) => !e.listed);
  if (unlistedNew.length) {
    try {
      const r = await steam.actions.store_items({
        appids: unlistedNew.map((e) => e.appid),
      });
      const items = new Map(
        (r?.response?.store_items ?? []).map((i) => [String(i.appid), i]),
      );
      for (const e of unlistedNew) {
        const item = items.get(String(e.appid));
        if (item?.success === 1) {
          e.name = item.name ?? e.name;
          if (item.type !== STORE_TYPE_GAME)
            e.storeType = STORE_TYPES[item.type] ?? `type ${item.type}`;
        } else {
          e.storeType = "unknown";
        }
      }
    } catch {
      for (const e of unlistedNew) e.skip = true;
    }
  }
  const fresh = candidates.filter((e) => !e.skip);

  if (fresh.length) {
    log(`Adding ${fresh.length} new game${fresh.length > 1 ? "s" : ""}...`);
    for (const e of fresh) {
      if (e.hasStats !== null && e.name) continue;
      // The achievements list also carries a name, which is the only one
      // Steam gives for some apps the store doesn't know (Spacewar).
      const schema = await steam.actions
        .schemas({ appid: e.appid })
        .catch(() => null);
      if (e.hasStats === null)
        e.hasStats =
          (schema?.game?.availableGameStats?.achievements?.length ?? 0) > 0;
      if (!e.name && schema?.game?.gameName) e.name = schema.game.gameName;
    }
    const inserted = await db.insert(
      "player_games",
      fresh.map((e) => ({
        platform: "pc",
        version: "steam",
        playtime: e.playtime,
        last_played: iso(e.lastPlayed),
        meta: {
          appid: e.appid,
          has_stats: e.hasStats,
          name: e.name,
          ...(e.storeType && { store_type: e.storeType }),
        },
        synced_at: new Date().toISOString(),
      })),
    );
    for (const r of inserted) {
      report.new_games.push(r.meta.name);
      if (r.meta.has_stats) needsFullLoad.add(r.id);
      byApp.set(String(r.meta.appid), { ...r, achievements: [{ count: 0 }] });
    }
  }

  // The matcher only looks at unlinked rows not waiting for review, so this
  // is just the new games plus any whose earlier match attempt failed.
  // A matching failure (IGDB down, say) must not stop playtime and
  // achievements; unlinked rows are simply tried again next run.
  if (fresh.length) log("Matching new games...");
  let match = { linked: [], review: [], failed: [] };
  try {
    match = await matchPlatform("steam");
    report.match = {
      linked: match.linked.length,
      review: match.review.length,
      failed: match.failed.length,
    };
  } catch (err) {
    report.match = { error: err.message };
  }

  // The matcher rewrote those rows' meta; refresh our copies so the playtime
  // update below doesn't save the old meta back over it.
  const touched = [...match.linked, ...match.review].map((m) => m.row_id);
  if (touched.length) {
    const after = await db.select(
      "player_games",
      `id=in.(${touched.join(",")})&select=id,igdb_id,meta`,
    );
    for (const a of after) {
      const key = String(a.meta?.appid);
      const old = byApp.get(key);
      if (old) byApp.set(key, { ...old, igdb_id: a.igdb_id, meta: a.meta });
    }
  }

  /* Played games, most recent first. */
  const played = [];
  for (const e of info.values()) {
    const row = byApp.get(String(e.appid));
    if (!row || ignored.has(String(e.appid))) continue;
    const lastPlayed = e.lastPlayed ?? seconds(row.last_played);
    if (
      e.playtime !== Number(row.playtime ?? 0) ||
      lastPlayed !== seconds(row.last_played) ||
      (e.hasStats !== null && e.hasStats !== !!row.meta?.has_stats)
    ) {
      played.push({ e, row, lastPlayed });
    }
  }
  played.sort((a, b) => b.lastPlayed - a.lastPlayed);

  // Loaded-but-unfinished games that weren't played still get their turn.
  const playedIds = new Set(played.map((p) => p.row.id));
  const leftovers = [...needsFullLoad].filter((id) => !playedIds.has(id));

  const total = played.length + leftovers.length;
  let step = 0;
  let pageReads = 0;

  const label = async (row) => {
    if (row.meta?.name) return row.meta.name;
    if (row.igdb_id) {
      const [game] = await db.select(
        "games",
        `id=eq.${row.igdb_id}&select=name`,
      );
      if (game?.name) return game.name;
    }
    return `app ${row.meta?.appid}`;
  };

  const fullLoad = async (row) => {
    if (pageReads++) await wait(PAGE_PAUSE_MS);
    const r = await loadSteamAchievements({
      db,
      ownedGameId: row.id,
      appid: row.meta.appid,
      steamId,
      retryDelays: [10000],
    });
    report.full_loads++;
    return r;
  };

  // meta with progress_hidden, secret_text_unavailable and no_achievements
  // set or cleared to match the latest answer. `load` is a full load's
  // result, or null when there wasn't one (then the last two are left as
  // they were).
  const withFlags = (meta, progressHidden, load) => {
    const next = { ...meta };
    if (progressHidden) next.progress_hidden = true;
    else delete next.progress_hidden;
    if (load) {
      if (load.pageOk && load.secretMissingText > 0)
        next.secret_text_unavailable = true;
      else delete next.secret_text_unavailable;
      if (load.total === 0) next.no_achievements = true;
      else delete next.no_achievements;
    }
    return next;
  };
  const flagsChanged = (a, b) =>
    !!a?.progress_hidden !== !!b.progress_hidden ||
    !!a?.secret_text_unavailable !== !!b.secret_text_unavailable ||
    !!a?.no_achievements !== !!b.no_achievements;

  for (const p of played) {
    if (Date.now() > deadline) break;
    step++;
    const title = await label(p.row);
    try {
      // Unlisted games carry no achievements flag; a game that had none
      // could gain them in an update, so ask again whenever it's played.
      let hasStats = p.e.hasStats;
      if (hasStats === null)
        hasStats =
          !!p.row.meta?.has_stats || (await hasAchievements(p.e.appid));

      let progressHidden = !!p.row.meta?.progress_hidden;
      let load = null;
      if (hasStats) {
        log(`Updating achievements for ${title} (${step}/${total})...`);
        // A played no_achievements game is asked again, in case an update
        // added some (the unlocks call errors for games with none).
        if (
          needsFullLoad.has(p.row.id) ||
          !p.row.meta?.has_stats ||
          p.row.meta?.no_achievements
        ) {
          load = await fullLoad(p.row);
          progressHidden = load.progressHidden;
        } else {
          const r = await refreshSteamUnlocks({
            db,
            ownedGameId: p.row.id,
            appid: p.e.appid,
            steamId,
            retryDelays: [10000],
          });
          progressHidden = r.progressHidden;
          load = r.fullLoad;
          if (r.fullLoad) report.full_loads++;
          else report.new_unlocks += r.newUnlocks;
        }
      } else {
        log(`Updating ${title} (${step}/${total})...`);
      }
      await db.update("player_games", `id=eq.${p.row.id}`, {
        playtime: p.e.playtime,
        last_played: iso(p.lastPlayed),
        meta: withFlags(
          { ...p.row.meta, has_stats: hasStats },
          progressHidden,
          load,
        ),
        synced_at: new Date().toISOString(),
      });
      report.updated++;
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }

  const rowsById = new Map([...byApp.values()].map((r) => [r.id, r]));
  for (const id of leftovers) {
    if (Date.now() > deadline) break;
    const row = rowsById.get(id);
    if (!row) continue;
    step++;
    const title = await label(row);
    try {
      log(`Loading achievements for ${title} (${step}/${total})...`);
      const r = await fullLoad(row);
      const meta = withFlags(row.meta, r.progressHidden, r);
      if (flagsChanged(row.meta, meta)) {
        await db.update("player_games", `id=eq.${row.id}`, { meta });
      }
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }

  report.unfinished = total - step;
  return report;
}

module.exports = { updateSteam };
