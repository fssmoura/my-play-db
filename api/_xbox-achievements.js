// Loads one Xbox title's achievements into `achievements`. Server-side only
// (service role). Shared by the one-off import and the updater.
//
// One `achievements` call (contract v4) gives everything: names, real secret
// descriptions, icons, rarity, gamerscore and the player's unlocks. Xbox has
// no achievement groups, so group_name stays null.

const { actions } = require("./xbox");

// Xbox's "never" date for an achievement not earned.
const NO_DATE = /^0001-/;

/**
 * options: { db, ownedGameId, titleId, xuid, userHash, xstsToken, dryRun }
 * Returns { total, unlocked, secret }; dryRun reads everything and saves
 * nothing. Throws if Xbox can't be read, so a half-read title is never saved.
 * An achievement earned with no date is stored locked, and an unlock already
 * stored is never cleared.
 */
async function loadXboxAchievements({
  db,
  ownedGameId,
  titleId,
  xuid,
  userHash,
  xstsToken,
  dryRun = false,
}) {
  const data = await actions.achievements({
    xuid,
    userHash,
    xstsToken,
    titleId,
  });
  if (data.pagingInfo?.continuationToken)
    throw new Error(`title ${titleId} has more than one page of achievements`);
  const list = data.achievements ?? [];
  if (!list.length) return { total: 0, unlocked: 0, secret: 0 };

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
  const rows = list.map((a) => {
    const earned =
      a.progressState === "Achieved" &&
      a.progression?.timeUnlocked &&
      !NO_DATE.test(a.progression.timeUnlocked)
        ? a.progression.timeUnlocked
        : null;
    const score = (a.rewards ?? []).find((r) => r?.type === "Gamerscore");
    const rarity = a.rarity?.currentPercentage;
    const row = {
      owned_game_id: ownedGameId,
      platform_key: String(a.id),
      group_name: null,
      name: a.name || String(a.id),
      description: a.description || a.lockedDescription || null,
      icon: (a.mediaAssets ?? []).find((m) => m?.type === "Icon")?.url || null,
      rarity: Number.isFinite(rarity) ? Math.round(rarity * 100) / 100 : null,
      tier: null,
      points: score ? parseInt(score.value, 10) || 0 : null,
      secret: !!a.isSecret,
      unlocked_at: earned || existing.get(String(a.id))?.unlocked_at || null,
    };
    if (row.unlocked_at) unlocked++;
    if (row.secret) secret++;
    return row;
  });

  if (!dryRun)
    await db.upsert("achievements", "owned_game_id,platform_key", rows);
  return { total: rows.length, unlocked, secret };
}

module.exports = { loadXboxAchievements };
