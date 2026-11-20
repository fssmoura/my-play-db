// The EA updater. Server-side only (service role). Called by
// api/library-sync.js; safe to run as often as wanted. See
// docs/database.md#the-ea-updater.

const { actions } = require("./ea");
const { matchPlatform } = require("./_match");
const { loadEaAchievements } = require("./_ea-achievements");

/**
 * options: { db, accessToken, personaId, deadline (ms epoch), log(message) }
 * Returns the same summary shape as the other updaters. Throws only when EA's
 * library can't be read.
 *
 * EA almost never has a last-played date, so a game's last_played is the
 * moment a run sees its playtime go up (EA's own date when it has a later
 * one). Playtime is saved only after its achievements succeed, so a failure
 * still looks "played" next run and is retried. A lower playtime than stored
 * is treated as an EA glitch and ignored. Nothing is ever deleted.
 */
async function updateEa({
  db,
  accessToken,
  personaId,
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

  log("Checking EA library...");
  const { records } = await actions.library({ accessToken });
  if (!records?.length) throw new Error("EA returned an empty library");
  const info = new Map(records.map((r) => [r.originOfferId, r]));

  const [rows, ignoredRows] = await Promise.all([
    db.select(
      "player_games",
      "version=eq.ea&meta->>origin_offer_id=not.is.null&select=id,igdb_id,playtime,last_played,meta,achievements(count)",
    ),
    db.select("ignored_games", "platform=eq.ea&select=external_id"),
  ]);
  const byOffer = new Map(rows.map((r) => [r.meta.origin_offer_id, r]));
  const ignored = new Set(ignoredRows.map((r) => String(r.external_id)));

  /* New games. */
  const fresh = records.filter(
    (r) => !byOffer.has(r.originOfferId) && !ignored.has(r.originOfferId),
  );
  if (fresh.length) {
    log(`Adding ${fresh.length} new game${fresh.length > 1 ? "s" : ""}...`);
    const inserted = await db.insert(
      "player_games",
      fresh.map((r) => ({
        platform: "pc",
        version: "ea",
        playtime: r.playtimeSeconds,
        last_played: r.lastPlayedDate,
        acquisition: r.addedDate,
        meta: {
          origin_offer_id: r.originOfferId,
          game_slug: r.gameSlug,
          ...(r.achievementSetOverride
            ? { achievement_set_override: r.achievementSetOverride }
            : {}),
          name: r.name,
        },
        synced_at: new Date().toISOString(),
      })),
    );
    for (const r of inserted) {
      report.new_games.push(r.meta.name);
      byOffer.set(r.meta.origin_offer_id, {
        ...r,
        achievements: [{ count: 0 }],
      });
    }
  }

  // As for the other stores: the matcher only looks at unlinked rows not
  // waiting for review, and its failure must not stop playtime and
  // achievements.
  if (fresh.length) log("Matching new games...");
  let match = { linked: [], review: [], failed: [] };
  try {
    match = await matchPlatform("ea");
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
      const old = byOffer.get(a.meta.origin_offer_id);
      if (old)
        byOffer.set(a.meta.origin_offer_id, {
          ...old,
          igdb_id: a.igdb_id,
          meta: a.meta,
        });
    }
  }

  /* Played games, plus games whose achievement list is still missing. */
  const played = [];
  for (const r of records) {
    const row = byOffer.get(r.originOfferId);
    if (!row || ignored.has(r.originOfferId)) continue;
    if ((r.playtimeSeconds ?? 0) > Number(row.playtime ?? 0))
      played.push({ r, row });
  }
  const playedIds = new Set(played.map((p) => p.row.id));
  const leftovers = [...byOffer.values()].filter(
    (row) =>
      !playedIds.has(row.id) &&
      !ignored.has(row.meta.origin_offer_id) &&
      (row.meta.achievement_set_override ||
        info.get(row.meta.origin_offer_id)?.achievementSetOverride) &&
      !(row.achievements?.[0]?.count > 0),
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
    return row.meta?.game_slug ?? row.meta?.origin_offer_id;
  };
  // A game that gained an achievement set in an update gets it from EA's
  // current list; one that had a set never loses it.
  const setOf = (row) =>
    row.meta.achievement_set_override ||
    info.get(row.meta.origin_offer_id)?.achievementSetOverride ||
    null;
  const load = (row) =>
    loadEaAchievements({
      db,
      ownedGameId: row.id,
      achievementSetOverride: setOf(row),
      accessToken,
      personaId,
    });

  const total = played.length + leftovers.length;
  let step = 0;

  for (const { r, row } of played) {
    if (Date.now() > deadline) break;
    step++;
    const title = await label(row);
    try {
      log(`Updating ${title} (${step}/${total})...`);
      const set = setOf(row);
      let res = { total: 0, unlocked: 0 };
      if (set) res = await load(row);
      if (res.total > 0)
        report.new_unlocks += Math.max(
          0,
          res.unlocked - (unlockedBefore.get(row.id) ?? 0),
        );
      const now = new Date().toISOString();
      // EA's own date, when it has one from around now, beats the run's time.
      const eaMs = Date.parse(r.lastPlayedDate ?? "");
      const storedMs = row.last_played ? Date.parse(row.last_played) : 0;
      const eaRecent =
        Number.isFinite(eaMs) &&
        eaMs > storedMs &&
        Date.now() - eaMs < 2 * 24 * 60 * 60 * 1000;
      await db.update("player_games", `id=eq.${row.id}`, {
        playtime: r.playtimeSeconds,
        last_played: eaRecent ? r.lastPlayedDate : now,
        meta: {
          ...row.meta,
          ...(set ? { achievement_set_override: set } : {}),
        },
        synced_at: now,
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
      if (!row.meta.achievement_set_override)
        await db.update("player_games", `id=eq.${row.id}`, {
          meta: { ...row.meta, achievement_set_override: setOf(row) },
        });
      report.full_loads++;
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }

  report.unfinished = total - step;
  return report;
}

module.exports = { updateEa };
