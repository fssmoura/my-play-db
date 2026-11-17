// Loads one PlayStation row's trophies into `achievements`. Server-side only
// (service role). Shared by the one-off import and the updater.
//
// A row can hold several trophy lists (meta.trophy_sets: Naruto Storm
// Trilogy has three). Each list is one `trophies` call - definitions plus the
// player's unlocks - and, when it has DLC groups or the row has more than one
// list, one `groups` call for the group names. PS4 and PS5 lists of one game
// sit on their own rows and are never merged here.

const { actions } = require("./psn");

/**
 * options: { db, ownedGameId, sets: [{ id, service }], authorization, dryRun }
 * Returns { total, unlocked, lists: [{ id, total, earned: {tier: n},
 * earnedError }] }; dryRun reads everything and saves nothing. Throws if any
 * list can't be read, so a half-read row is
 * never saved. A trophy Sony doesn't confirm unlocked is stored locked
 * (including when Sony refuses the player's progress, `earnedError`), and an
 * unlock already stored is never cleared.
 */
async function loadPsnTrophies({
  db,
  ownedGameId,
  sets,
  authorization,
  dryRun = false,
}) {
  if (!sets?.length) return { total: 0, unlocked: 0, lists: [] };

  const lists = [];
  for (const set of sets) {
    const opts = { npCommunicationId: set.id, npServiceName: set.service };
    const data = await actions.trophies(authorization, opts);
    const groups =
      data.hasTrophyGroups || sets.length > 1
        ? await actions.groups(authorization, opts)
        : null;
    lists.push({ set, data, groups });
  }

  const existing = new Map(
    (
      await db.select(
        "achievements",
        `owned_game_id=eq.${ownedGameId}&select=platform_key,unlocked_at`,
      )
    ).map((r) => [r.platform_key, r.unlocked_at]),
  );

  const rows = [];
  const summary = [];
  for (const { set, data, groups } of lists) {
    const groupName = new Map(
      (groups?.trophyGroups ?? []).map((g) => [
        g.trophyGroupId,
        g.trophyGroupName?.trim() || null,
      ]),
    );
    const earned = {};
    for (const t of data.trophies) {
      const key = `${set.id}:${t.trophyId}`;
      const rate = parseFloat(t.trophyEarnedRate);
      const row = {
        owned_game_id: ownedGameId,
        platform_key: key,
        group_name: groups ? (groupName.get(t.trophyGroupId) ?? null) : null,
        name: t.trophyName?.trim() || key,
        description: t.trophyDetail?.trim() || null,
        icon: t.trophyIconUrl || null,
        rarity: Number.isFinite(rate) ? Math.round(rate * 100) / 100 : null,
        tier: t.trophyType || null,
        points: null,
        secret: !!t.trophyHidden,
        unlocked_at:
          (t.earned && t.earnedDateTime) || existing.get(key) || null,
      };
      if (row.unlocked_at) earned[row.tier] = (earned[row.tier] ?? 0) + 1;
      rows.push(row);
    }
    summary.push({
      id: set.id,
      total: data.trophies.length,
      earned,
      earnedError: data.earnedError,
    });
  }

  if (rows.length && !dryRun)
    await db.upsert("achievements", "owned_game_id,platform_key", rows);
  return {
    total: rows.length,
    unlocked: rows.filter((r) => r.unlocked_at).length,
    lists: summary,
  };
}

module.exports = { loadPsnTrophies };
