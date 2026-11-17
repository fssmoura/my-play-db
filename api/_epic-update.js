// The Epic updater. Server-side only (service role). Called by
// api/library-sync.js; safe to run as often as wanted. See
// docs/database.md#the-epic-updater.

const { actions } = require("./epic");
const { matchPlatform } = require("./_match");
const { loadEpicAchievements } = require("./_epic-achievements");

/**
 * Epic's library as Map(namespace -> { namespace, appName, catalogItemId,
 * productId, acquisitionDate, playtime (s) }). A namespace Epic times as
 * several apps (Fortnite + Rocket Racing) is one entry with the time added up.
 */
async function readEpic({ accessToken, epicAccountId }) {
  const { records } = await actions.library({ accessToken, epicAccountId });
  if (!records?.length) throw new Error("Epic returned an empty library");
  const info = new Map();
  for (const r of records) {
    const e = info.get(r.namespace);
    if (e) {
      e.playtime += r.playtime ?? 0;
      continue;
    }
    info.set(r.namespace, {
      namespace: r.namespace,
      appName: r.appName ?? null,
      catalogItemId: r.catalogItemId ?? null,
      productId: r.productId ?? null,
      acquisitionDate: r.acquisitionDate ?? null,
      playtime: r.playtime ?? 0,
    });
  }
  return info;
}

/**
 * options: { db, accessToken, epicAccountId, deadline (ms epoch), log(message) }
 * Returns the same summary shape as the Steam updater. Throws only when
 * Epic's library can't be read.
 *
 * Epic gives no last-played date, so a game's last_played is the moment a run
 * sees its playtime go up. Playtime is saved only after its achievements
 * succeed, so a failure still looks "played" next run and is retried. A lower
 * playtime than stored is treated as an Epic glitch and ignored. Nothing is
 * ever deleted.
 */
async function updateEpic({
  db,
  accessToken,
  epicAccountId,
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

  log("Checking Epic library...");
  const info = await readEpic({ accessToken, epicAccountId });

  const [rows, ignoredRows] = await Promise.all([
    db.select(
      "player_games",
      "version=eq.epic&select=id,igdb_id,playtime,meta,achievements(count)",
    ),
    db.select("ignored_games", "platform=eq.epic&select=external_id"),
  ]);
  const byNs = new Map(rows.map((r) => [r.meta?.namespace, r]));
  const ignored = new Set(ignoredRows.map((r) => String(r.external_id)));

  // Epic's library call carries on without playtime if that part fails, which
  // would look like every game at zero. Stop rather than act on it.
  const storedTime = rows.some((r) => Number(r.playtime) > 0);
  const seenTime = [...info.values()].some((e) => e.playtime > 0);
  if (storedTime && !seenTime)
    throw new Error("Epic returned no playtime (Epic down?)");

  /* New games. */
  const fresh = [...info.values()].filter(
    (e) => !byNs.has(e.namespace) && !ignored.has(e.namespace),
  );
  if (fresh.length) {
    log(`Adding ${fresh.length} new game${fresh.length > 1 ? "s" : ""}...`);
    const titled = fresh.filter((e) => e.catalogItemId);
    const [titles, progress] = await Promise.all([
      titled.length
        ? actions
            .catalog({
              accessToken,
              items: titled.map((e) => ({
                namespace: e.namespace,
                catalogItemId: e.catalogItemId,
              })),
            })
            .catch(() => [])
        : [],
      actions.progress({
        accessToken,
        epicAccountId,
        sandboxIds: fresh.map((e) => e.namespace),
      }),
    ]);
    const withAch = new Set(progress.map((p) => p.sandboxId));
    const inserted = await db.insert(
      "player_games",
      fresh.map((e) => ({
        platform: "pc",
        version: "epic",
        playtime: e.playtime,
        acquisition: e.acquisitionDate,
        meta: {
          namespace: e.namespace,
          catalog_item_id: e.catalogItemId,
          app_name: e.appName,
          product_id: e.productId,
          name:
            titles.find(
              (t) => t?.namespace === e.namespace || t?.id === e.catalogItemId,
            )?.title ?? e.appName,
          has_achievements: withAch.has(e.namespace),
        },
        synced_at: new Date().toISOString(),
      })),
    );
    for (const r of inserted) {
      report.new_games.push(r.meta.name);
      byNs.set(r.meta.namespace, { ...r, achievements: [{ count: 0 }] });
    }
  }

  // Same as Steam: the matcher only looks at unlinked rows not waiting for
  // review, and its failure must not stop playtime and achievements.
  if (fresh.length) log("Matching new games...");
  let match = { linked: [], review: [], failed: [] };
  try {
    match = await matchPlatform("epic");
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
      const old = byNs.get(a.meta?.namespace);
      if (old)
        byNs.set(a.meta.namespace, {
          ...old,
          igdb_id: a.igdb_id,
          meta: a.meta,
        });
    }
  }

  /* Played games, plus games whose achievement list is still missing. */
  const played = [];
  for (const e of info.values()) {
    const row = byNs.get(e.namespace);
    if (!row || ignored.has(e.namespace)) continue;
    if (e.playtime > Number(row.playtime ?? 0)) played.push({ e, row });
  }
  const playedIds = new Set(played.map((p) => p.row.id));
  const leftovers = [...byNs.values()].filter(
    (r) =>
      !playedIds.has(r.id) &&
      r.meta?.has_achievements &&
      !(r.achievements?.[0]?.count > 0),
  );

  const unlockedBefore = new Map();
  if (played.length) {
    const ids = played.map((p) => p.row.id).join(",");
    for (const a of await db.select(
      "achievements",
      `owned_game_id=in.(${ids})&unlocked_at=not.is.null&select=owned_game_id`,
    )) {
      unlockedBefore.set(
        a.owned_game_id,
        (unlockedBefore.get(a.owned_game_id) ?? 0) + 1,
      );
    }
  }

  const label = async (row) => {
    if (row.meta?.name) return row.meta.name;
    if (row.igdb_id) {
      const [game] = await db.select(
        "games",
        `id=eq.${row.igdb_id}&select=name`,
      );
      if (game?.name) return game.name;
    }
    return row.meta?.app_name ?? row.meta?.namespace;
  };
  const load = (row) =>
    loadEpicAchievements({
      db,
      ownedGameId: row.id,
      namespace: row.meta.namespace,
      accessToken,
      epicAccountId,
    });

  const total = played.length + leftovers.length;
  let step = 0;

  for (const { e, row } of played) {
    if (Date.now() > deadline) break;
    step++;
    const title = await label(row);
    try {
      // Every played game is asked, so one that gained achievements in an
      // update is picked up. Only ever switched on: a failed lookup reads as
      // "none", and must not hide a list that exists.
      log(`Updating ${title} (${step}/${total})...`);
      const r = await load(row);
      const hasAch = !!row.meta?.has_achievements || r.total > 0;
      if (r.total > 0)
        report.new_unlocks += Math.max(
          0,
          r.unlocked - (unlockedBefore.get(row.id) ?? 0),
        );
      await db.update("player_games", `id=eq.${row.id}`, {
        playtime: e.playtime,
        last_played: new Date().toISOString(),
        meta: { ...row.meta, has_achievements: hasAch },
        synced_at: new Date().toISOString(),
      });
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
      await load(row);
      report.full_loads++;
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }

  report.unfinished = total - step;
  return report;
}

module.exports = { updateEpic };
