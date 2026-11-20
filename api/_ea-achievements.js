// Loads one EA game's achievements into `achievements`. Server-side only
// (service role). Shared by the one-off import and the updater.
//
// One `achievements` call (EA's GraphQL) gives the full list, locked ones
// included, with descriptions and icons. EA gives no groups, rarity, points or
// secret flag, so those stay empty.

const { actions } = require("./ea");

/**
 * options: { db, ownedGameId, achievementSetOverride, accessToken, personaId,
 * dryRun }
 * Returns { total, unlocked }; dryRun reads everything and saves nothing.
 * Throws if EA can't be read, so a half-read game is never saved. Unlocks
 * already stored are never cleared.
 */
async function loadEaAchievements({
  db,
  ownedGameId,
  achievementSetOverride,
  accessToken,
  personaId,
  dryRun = false,
}) {
  const data = await actions.achievements({
    accessToken,
    personaId,
    achievementSetOverride,
  });
  if (!data.achievements.length) return { total: 0, unlocked: 0 };

  const existing = new Map(
    (
      await db.select(
        "achievements",
        `owned_game_id=eq.${ownedGameId}&select=platform_key,unlocked_at`,
      )
    ).map((r) => [r.platform_key, r]),
  );

  let unlocked = 0;
  const rows = data.achievements.map((a) => {
    const key = String(a.id);
    const row = {
      owned_game_id: ownedGameId,
      platform_key: key,
      group_name: null,
      name: a.name || key,
      description: a.description || null,
      icon: a.iconUrl || null,
      rarity: null,
      tier: null,
      points: null,
      secret: false,
      unlocked_at:
        (a.unlocked && a.unlockDate) || existing.get(key)?.unlocked_at || null,
    };
    if (row.unlocked_at) unlocked++;
    return row;
  });

  if (!dryRun)
    await db.upsert("achievements", "owned_game_id,platform_key", rows);
  return { total: rows.length, unlocked };
}

module.exports = { loadEaAchievements };
