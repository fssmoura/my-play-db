// The Xbox updater. Server-side only (service role). Called by
// api/library-sync.js; safe to run as often as wanted. See
// docs/database.md#the-xbox-updater.

const { actions } = require("./xbox");
const { matchPlatform } = require("./_match");
const { loadXboxAchievements } = require("./_xbox-achievements");

const productIdOf = (t) =>
  (t.detail?.availabilities ?? []).find((a) => a?.ProductId)?.ProductId ?? null;

/** What one Xbox title gives the row, the same way the first import read it. */
function readTitle(t) {
  const productId = productIdOf(t);
  return {
    titleId: String(t.titleId),
    name: t.name ?? null,
    productId,
    lastPlayed: t.titleHistory?.lastTimePlayed ?? null,
    // Only store titles have playtime; launched ones get only a date.
    playtime:
      productId && t.minutesPlayed != null ? t.minutesPlayed * 60 : null,
    hasAchievements: (t.achievement?.totalGamerscore ?? 0) > 0,
    earned: t.achievement?.currentAchievements ?? null,
  };
}

const later = (a, b) => !!a && (!b || new Date(a) > new Date(b));

/**
 * options: { db, xuid, userHash, xstsToken, deadline (ms epoch), log, dryRun }
 * Returns the same summary shape as the other updaters. Throws only when the
 * Xbox list can't be read. dryRun reads everything and writes nothing (no
 * inserts, no matcher, no achievements, no row updates) and adds `plan`.
 *
 * Rows are found by meta.title_id and `version` is never written, so a
 * hand-set version stays. Play data only moves forward. A row's playtime and
 * date are saved only after its achievements succeed, so a failure is retried
 * next run. Nothing is ever deleted.
 */
async function updateXbox({
  db,
  xuid,
  userHash,
  xstsToken,
  deadline = Infinity,
  log = () => {},
  dryRun = false,
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
  const plan = dryRun ? { insert: [], update: [], full_loads: [] } : null;

  log("Checking Xbox library...");
  const { titles } = await actions.games({
    xuid,
    userHash,
    xstsToken,
    decorations: "detail,achievement",
  });
  if (!titles?.length) throw new Error("Xbox returned an empty library");
  const info = new Map(titles.map((t) => [String(t.titleId), readTitle(t)]));

  const [rows, ignoredRows] = await Promise.all([
    db.select(
      "player_games",
      "platform=eq.pc&meta->>title_id=not.is.null&select=id,igdb_id,playtime,last_played,meta,achievements(count)",
    ),
    db.select("ignored_games", "platform=eq.xbox&select=external_id"),
  ]);
  const byTitle = new Map(rows.map((r) => [String(r.meta.title_id), r]));
  const ignored = new Set(ignoredRows.map((r) => String(r.external_id)));

  // Playtime comes from a second call that the games action skips quietly
  // when it fails, which would look like no store title has any. Stop rather
  // than act on it.
  const storeRows = rows.filter((r) => r.meta?.product_id);
  if (
    storeRows.some((r) => r.playtime != null) &&
    !storeRows.some((r) => info.get(String(r.meta.title_id))?.playtime != null)
  )
    throw new Error("Xbox returned no playtime (Xbox down?)");

  /* New titles, saved as the first import did. */
  const fresh = [...info.values()].filter(
    (e) => !byTitle.has(e.titleId) && !ignored.has(e.titleId),
  );
  if (fresh.length) {
    log(`Adding ${fresh.length} new game${fresh.length > 1 ? "s" : ""}...`);
    const newRows = fresh.map((e) => ({
      platform: "pc",
      version: e.productId ? "microsoft" : null,
      playtime: e.playtime,
      last_played: e.lastPlayed,
      meta: {
        title_id: e.titleId,
        ...(e.productId ? { product_id: e.productId } : {}),
        has_achievements: e.hasAchievements,
        name: e.name,
      },
      synced_at: new Date().toISOString(),
    }));
    if (dryRun) plan.insert.push(...newRows);
    else {
      const inserted = await db.insert("player_games", newRows);
      for (const r of inserted) {
        report.new_games.push(r.meta.name);
        byTitle.set(String(r.meta.title_id), {
          ...r,
          achievements: [{ count: 0 }],
        });
      }
    }
  }

  // As for the others: the matcher only looks at unlinked rows not waiting
  // for review, and its failure must not stop play data and achievements.
  if (!dryRun) {
    if (fresh.length) log("Matching new games...");
    let match = { linked: [], review: [], failed: [] };
    try {
      match = await matchPlatform("xbox");
      report.match = {
        linked: match.linked.length,
        review: match.review.length,
        failed: match.failed.length,
      };
    } catch (err) {
      report.match = { error: err.message };
    }
    // The matcher rewrote those rows' meta; refresh our copies so the updates
    // below don't save the old meta back over it.
    const touched = [...match.linked, ...match.review].map((m) => m.row_id);
    if (touched.length) {
      const after = await db.select(
        "player_games",
        `id=in.(${touched.join(",")})&select=id,igdb_id,meta`,
      );
      for (const a of after) {
        const key = String(a.meta?.title_id);
        const old = byTitle.get(key);
        if (old) byTitle.set(key, { ...old, igdb_id: a.igdb_id, meta: a.meta });
      }
    }
  }

  const unlockedBefore = new Map();
  const achIds = [...byTitle.values()]
    .filter((r) => r.id && r.meta?.has_achievements)
    .map((r) => r.id);
  if (achIds.length) {
    for (const a of await db.select(
      "achievements",
      `owned_game_id=in.(${achIds.join(",")})&unlocked_at=not.is.null&select=owned_game_id`,
    )) {
      unlockedBefore.set(
        a.owned_game_id,
        (unlockedBefore.get(a.owned_game_id) ?? 0) + 1,
      );
    }
  }

  /* Rows whose play data or earned count moved, plus lists still missing. */
  const changed = [];
  for (const e of info.values()) {
    const row = byTitle.get(e.titleId);
    if (!row?.id || ignored.has(e.titleId)) continue;
    const store = !!row.meta?.product_id;
    const moreTime =
      store && e.playtime != null && e.playtime > Number(row.playtime ?? 0);
    const newerDate = later(e.lastPlayed, row.last_played);
    // has_achievements is only ever switched on: a title that gained a list
    // in an update is picked up, and a missing answer never hides one.
    const hasAch = !!row.meta?.has_achievements || (store && e.hasAchievements);
    // Xbox's date is when a session started, so unlocks later in that
    // session only show in the earned count.
    const moreEarned =
      hasAch &&
      e.earned != null &&
      e.earned > (unlockedBefore.get(row.id) ?? 0);
    if (
      moreTime ||
      newerDate ||
      moreEarned ||
      hasAch !== !!row.meta?.has_achievements
    )
      changed.push({ e, row, store, hasAch, moreTime, newerDate });
  }
  const changedIds = new Set(changed.map((c) => c.row.id));
  const leftovers = [...byTitle.values()].filter(
    (r) =>
      r.id &&
      !changedIds.has(r.id) &&
      r.meta?.has_achievements &&
      !(r.achievements?.[0]?.count > 0),
  );

  const label = async (row, e) => {
    if (row.meta?.name) return row.meta.name;
    if (row.igdb_id) {
      const [game] = await db.select(
        "games",
        `id=eq.${row.igdb_id}&select=name`,
      );
      if (game?.name) return game.name;
    }
    return e?.name ?? row.meta?.title_id;
  };
  const load = (row) =>
    loadXboxAchievements({
      db,
      ownedGameId: row.id,
      titleId: row.meta.title_id,
      xuid,
      userHash,
      xstsToken,
      dryRun,
    });

  const total = changed.length + leftovers.length;
  let step = 0;

  for (const { e, row, store, hasAch, moreTime, newerDate } of changed) {
    if (Date.now() > deadline) break;
    step++;
    const title = await label(row, e);
    try {
      log(`Updating ${title} (${step}/${total})...`);
      let r = null;
      if (hasAch) {
        r = await load(row);
        report.new_unlocks += Math.max(
          0,
          r.unlocked - (unlockedBefore.get(row.id) ?? 0),
        );
      }
      const patch = {
        ...(moreTime ? { playtime: e.playtime } : {}),
        ...(newerDate ? { last_played: e.lastPlayed } : {}),
        meta: { ...row.meta, has_achievements: hasAch },
        synced_at: new Date().toISOString(),
      };
      if (dryRun)
        plan.update.push({ id: row.id, title, store, patch, achievements: r });
      else await db.update("player_games", `id=eq.${row.id}`, patch);
      report.updated++;
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }

  for (const row of leftovers) {
    if (Date.now() > deadline) break;
    step++;
    const title = await label(row);
    try {
      log(`Loading achievements for ${title} (${step}/${total})...`);
      const r = await load(row);
      if (dryRun) plan.full_loads.push({ id: row.id, title, achievements: r });
      report.full_loads++;
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }

  report.unfinished = total - step;
  if (dryRun) report.plan = plan;
  return report;
}

module.exports = { updateXbox };
