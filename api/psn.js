const {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromAccountId,
  getBasicPresence,
  getUserTrophyProfileSummary,
  getUserPlayedGames,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
  getUserTrophiesForSpecificTitle,
} = require("psn-api");
const { setCorsHeaders, handlePreflight } = require("./_cors");

const TROPHY_PROXY_ACCOUNT_ID = "6515971742264256071";

async function authenticate(npsso) {
  const accessCode = await exchangeNpssoForAccessCode(npsso);
  return exchangeAccessCodeForAuthTokens(accessCode);
}

const actions = {
  async profile(authorization) {
    const [presence, trophySummary] = await Promise.all([
      getBasicPresence(authorization, "me"),
      getUserTrophyProfileSummary(authorization, "me"),
    ]);
    const profile = await getProfileFromAccountId(
      authorization,
      trophySummary.accountId,
    );
    return { profile, presence, trophySummary };
  },

  async games(authorization, options = {}) {
    const { limit, offset } = options;
    if (limit != null) {
      return getUserPlayedGames(authorization, "me", {
        limit: Number(limit),
        offset: Number(offset ?? 0),
        categories: "ps4_game,ps5_native_game,pspc_game",
      });
    }
    const pageSize = 100;
    const first = await getUserPlayedGames(authorization, "me", {
      limit: pageSize,
      offset: 0,
      categories: "ps4_game,ps5_native_game,pspc_game",
    });
    const titles = first.titles ?? [];
    let nextOffset = first.nextOffset;
    while (nextOffset != null) {
      const page = await getUserPlayedGames(authorization, "me", {
        limit: pageSize,
        offset: nextOffset,
        categories: "ps4_game,ps5_native_game,pspc_game",
      });
      titles.push(...(page.titles ?? []));
      nextOffset = page.nextOffset;
    }
    return { titles, totalItemCount: first.totalItemCount };
  },

  async trophymap(authorization, options = {}) {
    const titleIds = options.titleIds ?? [];
    if (!Array.isArray(titleIds) || titleIds.length === 0) {
      throw new Error("titleIds array is required");
    }

    const batchSize = 5;
    const concurrency = 10;
    const map = new Map();

    async function resolveBatches(ids, accountId) {
      const batches = [];
      for (let i = 0; i < ids.length; i += batchSize) {
        batches.push(ids.slice(i, i + batchSize));
      }
      for (let i = 0; i < batches.length; i += concurrency) {
        const chunk = batches.slice(i, i + concurrency);
        const results = await Promise.all(
          chunk.map((batch) =>
            getUserTrophiesForSpecificTitle(authorization, accountId, {
              npTitleIds: batch.join(","),
              includeNotEarnedTrophyIds: true,
            }).catch(() => ({ titles: [] })),
          ),
        );
        for (const result of results) {
          for (const title of result.titles ?? []) {
            const trophyTitle = title.trophyTitles?.[0];
            if (trophyTitle && !map.has(title.npTitleId)) {
              map.set(title.npTitleId, {
                npCommunicationId: trophyTitle.npCommunicationId,
                npServiceName: trophyTitle.npServiceName,
              });
            }
          }
        }
      }
    }

    await resolveBatches(titleIds, "me");

    const unresolved = titleIds.filter((id) => !map.has(id));
    if (unresolved.length > 0) {
      await resolveBatches(unresolved, TROPHY_PROXY_ACCOUNT_ID);
    }

    const resolved = {};
    for (const [id, data] of map.entries()) {
      resolved[id] = data;
    }
    return {
      resolved,
      unresolved: titleIds.filter((id) => !map.has(id)),
    };
  },

  async trophies(authorization, options = {}) {
    const { npCommunicationId, npServiceName } = options;
    if (!npCommunicationId) throw new Error("npCommunicationId is required");
    if (!npServiceName)
      throw new Error("npServiceName is required (trophy or trophy2)");

    const trophyOptions = { npServiceName };

    const [titleTrophies, earnedResult] = await Promise.all([
      getTitleTrophies(authorization, npCommunicationId, "all", trophyOptions),
      getUserTrophiesEarnedForTitle(
        authorization,
        "me",
        npCommunicationId,
        "all",
        trophyOptions,
      ).catch(() => null),
    ]);

    const earnedTrophies = earnedResult ?? {
      trophies: [],
      lastUpdatedDateTime: null,
    };
    const earnedMap = new Map(
      (earnedTrophies.trophies ?? []).map((e) => [e.trophyId, e]),
    );
    const trophies = (titleTrophies.trophies ?? []).map((t) => {
      const earned = earnedMap.get(t.trophyId) ?? {};
      return {
        trophyId: t.trophyId,
        trophyHidden: t.trophyHidden,
        trophyType: t.trophyType,
        trophyName: t.trophyName,
        trophyDetail: t.trophyDetail,
        trophyIconUrl: t.trophyIconUrl,
        trophyGroupId: t.trophyGroupId,
        trophyRare: earned.trophyRare ?? null,
        trophyEarnedRate: earned.trophyEarnedRate ?? null,
        earned: earned.earned ?? false,
        earnedDateTime: earned.earnedDateTime ?? null,
      };
    });

    return {
      npCommunicationId,
      npServiceName,
      trophySetVersion: titleTrophies.trophySetVersion,
      hasTrophyGroups: titleTrophies.hasTrophyGroups,
      totalItemCount: titleTrophies.totalItemCount,
      trophies,
    };
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  const body = req.method === "GET" ? req.query : (req.body ?? {});
  const { npsso, accessToken, refreshToken, action, options } = body;

  if (!action) return res.status(400).json({ error: "action is required" });

  if (action === "auth") {
    try {
      let tokens;
      if (refreshToken) {
        tokens = await exchangeRefreshTokenForAuthTokens(refreshToken);
      } else if (npsso) {
        const accessCode = await exchangeNpssoForAccessCode(npsso);
        tokens = await exchangeAccessCodeForAuthTokens(accessCode);
      } else {
        return res
          .status(400)
          .json({ error: "npsso or refreshToken is required for auth" });
      }
      const now = Date.now();
      return res.status(200).json({
        accessToken: tokens.accessToken,
        accessTokenExpiry: new Date(
          now + tokens.expiresIn * 1000,
        ).toISOString(),
        refreshToken: tokens.refreshToken,
        refreshTokenExpiry: new Date(
          now + tokens.refreshTokenExpiresIn * 1000,
        ).toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!actions[action])
    return res.status(400).json({ error: `Unknown action: ${action}` });

  let authorization;
  try {
    if (accessToken) {
      authorization = { accessToken };
    } else if (npsso) {
      authorization = await authenticate(npsso);
    } else {
      return res
        .status(400)
        .json({ error: "accessToken or npsso is required" });
    }
  } catch (err) {
    return res
      .status(401)
      .json({ error: `Authentication failed: ${err.message}` });
  }

  try {
    const data = await actions[action](authorization, options ?? {});
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
