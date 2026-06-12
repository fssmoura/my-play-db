const https = require("https");
const { setCorsHeaders, handlePreflight } = require("./_cors");

const GQL_HOST = "service-aggregation-layer.juno.ea.com";
const ACH_HOST = "achievements.gameservices.ea.com";

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function urlEncode(str) {
  return encodeURIComponent(str);
}

async function eaGraphQL(query, accessToken) {
  const url = `https://${GQL_HOST}/graphql?query=${urlEncode(query)}`;
  const { status, data } = await httpsRequest(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "EADesktop/12.95.0.5352",
    },
  });
  if (status !== 200) {
    const msg = data.error_description || data.error || data.message || status;
    throw new Error(`EA API error: ${status} ${msg}`);
  }
  if (data.errors) {
    throw new Error(`EA GraphQL error: ${data.errors[0].message}`);
  }
  return data.data;
}

const actions = {
  async auth(options = {}) {
    const { accessToken } = options;
    if (!accessToken) throw new Error("accessToken is required");

    const data = await eaGraphQL(
      `query{me{player{pd psd displayName}}}`,
      accessToken,
    );

    return {
      accessToken,
      pidId: data.me.player.pd,
      personaId: data.me.player.psd,
      displayName: data.me.player.displayName,
    };
  },

  async achievements(options = {}) {
    const { accessToken, personaId, achievementSetOverride, sandboxName } =
      options;
    if (!accessToken) throw new Error("accessToken is required");
    if (!personaId) throw new Error("personaId is required");
    if (!achievementSetOverride)
      throw new Error("achievementSetOverride is required");

    // Try legacy REST API first (has icons, descriptions)
    const { status, data } = await httpsRequest(
      `https://${ACH_HOST}/achievements/personas/${personaId}/all?lang=en_US`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Accept-Language": "en-US",
        },
      },
    );

    let legacySet = null;
    if (status === 200 && data?.[achievementSetOverride]) {
      legacySet = data[achievementSetOverride];
    }

    if (legacySet) {
      const entries = Object.entries(legacySet.achievements || {}).map(
        ([id, a]) => ({
          id,
          name: a.name,
          description: a.desc || null,
          howTo: a.howto || null,
          xp: a.xp || 0,
          hidden: a.hidden || false,
          rarity: a.achievedPercentage
            ? parseFloat(a.achievedPercentage)
            : null,
          iconUrl: a.icons?.["208"] || a.icons?.["416"] || null,
          unlocked: a.complete || false,
          unlockDate: a.u ? new Date(a.u * 1000).toISOString() : null,
        }),
      );
      const unlocked = entries.filter((a) => a.unlocked);
      return {
        sandboxName: sandboxName || null,
        achievementSetId: achievementSetOverride,
        totalAchievements: entries.length,
        totalUnlocked: unlocked.length,
        achievements: entries,
      };
    }

    // Fallback to GraphQL API (no icons/descriptions, but data is always there)
    const ids = JSON.stringify([achievementSetOverride]);
    const gql = `query{achievements(achievementSetIds:${ids},playerPsd:"${personaId}",showHidden:true){id achievements{id name awardCount date}}}`;
    const gqlData = await eaGraphQL(gql, accessToken);
    const set = gqlData.achievements?.[0];

    if (!set) {
      return {
        sandboxName: sandboxName || null,
        totalAchievements: 0,
        totalUnlocked: 0,
        achievements: [],
      };
    }

    const all = set.achievements || [];
    const unlocked = all.filter((a) => a.awardCount === 1);

    return {
      sandboxName: sandboxName || null,
      achievementSetId: set.id,
      totalAchievements: all.length,
      totalUnlocked: unlocked.length,
      achievements: all.map((a) => ({
        id: a.id,
        name: a.name,
        unlocked: a.awardCount === 1,
        unlockDate: a.awardCount === 1 ? a.date : null,
      })),
    };
  },

  async library(options = {}) {
    const { accessToken } = options;
    if (!accessToken) throw new Error("accessToken is required");

    const entitlementsQuery = `query getPreloadedOwnedGames {
      me {
        ownedGameProducts(
          storefronts: [EA]
          locale: "DEFAULT"
          paging: {limit: 9999}
          productFound: true
          ownershipMethod: [PURCHASE, REDEMPTION, ENTITLEMENT_GRANT]
          type: [DIGITAL_FULL_GAME, PACKAGED_FULL_GAME]
          downloadableOnly: false
          platforms: [PC]
        ) {
          items {
            id: originOfferId
            product {
              id
              name
              gameSlug
            }
          }
        }
      }
    }`;

    const data = await eaGraphQL(entitlementsQuery, accessToken);
    const items = data.me.ownedGameProducts.items;

    const slugs = items.map((i) => i.product.gameSlug).filter(Boolean);
    let ptMap = {};
    if (slugs.length > 0) {
      try {
        const ptQuery = `query{me{recentGames(gameSlugs:${JSON.stringify(slugs)}){items{gameSlug totalPlayTimeSeconds lastSessionEndDate}}}}`;
        const ptData = await eaGraphQL(ptQuery, accessToken);
        if (ptData?.me?.recentGames?.items) {
          for (const g of ptData.me.recentGames.items) {
            ptMap[g.gameSlug] = {
              playtimeSeconds: g.totalPlayTimeSeconds,
              lastPlayedDate: g.lastSessionEndDate || null,
            };
          }
        }
      } catch {
        // playtime is optional
      }
    }

    const offerIds = items.map((i) => i.id).filter(Boolean);
    let offerMap = {};
    if (offerIds.length > 0) {
      try {
        const oIds = JSON.stringify(offerIds);
        const offerQuery = `query{legacyOffers(offerIds:${oIds},locale:"DEFAULT"){offerId:id displayName displayType contentId achievementSetOverride}gameProducts(offerIds:${oIds},locale:"DEFAULT"){items{id name originOfferId baseItem{gameType}gameSlug}}}`;
        const offerData = await eaGraphQL(offerQuery, accessToken);
        if (offerData?.legacyOffers) {
          for (const o of offerData.legacyOffers) {
            offerMap[o.offerId] = {
              displayName: o.displayName || null,
              displayType: o.displayType || null,
              contentId: o.contentId || null,
              achievementSetOverride: o.achievementSetOverride || null,
            };
          }
        }
      } catch {
        // metadata is optional
      }
    }

    return {
      records: items.map((i) => {
        const meta = offerMap[i.id] || {};
        return {
          originOfferId: i.id,
          productId: i.product.id,
          name: meta.displayName || i.product.name,
          gameSlug: i.product.gameSlug,
          contentId: meta.contentId || null,
          displayType: meta.displayType || null,
          achievementSetOverride: meta.achievementSetOverride || null,
          playtimeSeconds: ptMap[i.product.gameSlug]?.playtimeSeconds ?? null,
          lastPlayedDate: ptMap[i.product.gameSlug]?.lastPlayedDate ?? null,
        };
      }),
    };
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  const raw = req.method === "GET" ? req.query : (req.body ?? {});
  const body = {};
  for (const key of Object.keys(raw)) {
    try {
      body[key] = JSON.parse(raw[key]);
    } catch {
      body[key] = raw[key];
    }
  }
  const { action, options } = body;

  if (!action) return res.status(400).json({ error: "action is required" });

  if (!actions[action])
    return res.status(400).json({ error: `Unknown action: ${action}` });

  try {
    const data = await actions[action](options ?? {});
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
