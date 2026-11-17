// Loads one Epic game's full achievement list into `achievements`. Server-side
// only (service role). Shared by the one-off import and the updater.
//
// One `achievements` call gives everything: names, real secret descriptions,
// icons, rarity, XP and the player's unlocks. Epic splits a game's list into
// sets (base game, then one per add-on) but gives sets no name, so
// group_name stays null and add-on achievements sit with the game.

const { actions } = require("./epic");

/**
 * options: { db, ownedGameId, namespace, accessToken, epicAccountId }
 * Returns { total, unlocked, secret }; total 0 when the game has no
 * achievements. Throws if Epic can't be read, so a half-read game is never
 * saved. Unlocks already stored are never cleared.
 */
async function loadEpicAchievements({
  db,
  ownedGameId,
  namespace,
  accessToken,
  epicAccountId,
}) {
  let data;
  try {
    data = await actions.achievements({
      accessToken,
      epicAccountId,
      sandboxId: namespace,
    });
  } catch (err) {
    if (/No achievements configured/.test(err.message))
      return { total: 0, unlocked: 0, secret: 0 };
    throw err;
  }
  if (!data.achievements.length) return { total: 0, unlocked: 0, secret: 0 };

  const existing = new Map(
    (
      await db.select(
        "achievements",
        `owned_game_id=eq.${ownedGameId}&select=platform_key,unlocked_at`,
      )
    ).map((r) => [r.platform_key, r]),
  );

  let unlocked = 0;
  let secret = 0;
  const rows = data.achievements.map((a) => {
    const row = {
      owned_game_id: ownedGameId,
      platform_key: a.name,
      group_name: null,
      name: a.displayName || a.name,
      description: a.description || null,
      icon: a.iconUnlocked || null,
      rarity: Number.isFinite(a.rarity)
        ? Math.round(a.rarity * 100) / 100
        : null,
      tier: null,
      points: Number.isFinite(a.XP) ? a.XP : null,
      secret: !!a.hidden,
      unlocked_at:
        (a.unlocked && a.unlockDate) ||
        existing.get(a.name)?.unlocked_at ||
        null,
    };
    if (row.unlocked_at) unlocked++;
    if (row.secret) secret++;
    return row;
  });

  await db.upsert("achievements", "owned_game_id,platform_key", rows);
  return { total: rows.length, unlocked, secret };
}

module.exports = { loadEpicAchievements };
