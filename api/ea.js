const https = require("https");
const { setCorsHeaders, handlePreflight } = require("./_cors");
const { requireUser } = require("./_auth");

const GQL_HOST = "service-aggregation-layer.juno.ea.com";

// Minting a token from stored EA session cookies. This is the same request the
// ea.com website makes to keep itself signed in.
//
// Measured, by replaying a real browser request and removing one cookie at a
// time until it broke:
//   - `sid` + `_nx_mpcid` together are the MINIMUM EA accepts.
//   - any single cookie alone - including `sid` - is rejected as
//     `login_required`. That is what made the first attempt at this fail.
//   - `remid` is the long-lived "remember me" value and is expected to outlive
//     `sid`, but it only works alongside the others.
//   - EA hands back a replacement `sid` on nearly every call.
// So the whole cookie set is stored and replayed together, and anything that
// comes back in `set-cookie` overwrites what was sent. Miss a rotation and the
// chain is dead, and only a manual reconnect fixes it.
const EA_AUTH_URL =
  "https://accounts.ea.com/connect/auth" +
  "?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none";

// The cookies worth carrying. Everything else EA sets is consent/analytics
// noise that made no difference when removed.
const EA_COOKIE_NAMES = ["remid", "sid", "_nx_mpcid"];

// Every ownership method the EA app itself asks for (Playnite EA library
// plugin). Grouped there as: bought/linked = UNKNOWN..PRE_ORDER_PURCHASE,
// STEAM, EPIC; EA Play = VAULT, STEAM_VAULT, STEAM_SUBSCRIPTION, EPIC_VAULT,
// EPIC_SUBSCRIPTION; Game Pass = XGP_VAULT.
const OWNERSHIP_METHODS = [
  "UNKNOWN",
  "ASSOCIATION",
  "PURCHASE",
  "REDEMPTION",
  "GIFT_RECEIPT",
  "ENTITLEMENT_GRANT",
  "DIRECT_ENTITLEMENT",
  "PRE_ORDER_PURCHASE",
  "VAULT",
  "XGP_VAULT",
  "STEAM",
  "STEAM_VAULT",
  "STEAM_SUBSCRIPTION",
  "EPIC",
  "EPIC_VAULT",
  "EPIC_SUBSCRIPTION",
];

// EA rejects requests that don't look like a browser.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

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
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: JSON.parse(data),
          });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** "a=1; b=2" -> { a: "1", b: "2" }, keeping only the cookies we care about. */
function parseCookieLine(line) {
  const jar = {};
  for (const part of String(line ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (EA_COOKIE_NAMES.includes(name) && value) jar[name] = value;
  }
  return jar;
}

function formatCookieLine(jar) {
  return EA_COOKIE_NAMES.filter((n) => jar[n])
    .map((n) => `${n}=${jar[n]}`)
    .join("; ");
}

/** Applies EA's `set-cookie` rotations over the jar that was sent. */
function applyRotations(jar, setCookie) {
  const next = { ...jar };
  for (const line of setCookie ?? []) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    if (!EA_COOKIE_NAMES.includes(name)) continue;
    const value = line
      .slice(eq + 1)
      .split(";")[0]
      .trim();
    // An empty or "deleted" value is EA clearing the cookie, not rotating it -
    // keeping the old value is strictly better than storing a tombstone.
    if (value && value !== "deleted") next[name] = value;
  }
  return next;
}

/** Reads the stated lifetime of a rotated cookie, if EA gave one. */
function cookieExpiry(setCookie, name) {
  for (const line of setCookie ?? []) {
    if (!line.startsWith(`${name}=`)) continue;
    const raw = line.match(/expires=([^;]+)/i)?.[1];
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/**
 * Trades EA session cookies for a fresh access token.
 *
 * Accepts the whole cookie line; returns the token plus the cookie line as it
 * stands after EA's rotations, so the caller can persist it verbatim.
 */
async function mintFromCookies(input = {}) {
  // `cookies` is the real shape. The individual fields are accepted so an older
  // stored record still works without a reconnect.
  const jar = {
    ...parseCookieLine(input.cookies),
    ...(input.remid ? { remid: input.remid } : {}),
    ...(input.sid ? { sid: input.sid } : {}),
  };

  if (!Object.keys(jar).length) {
    throw new Error("EA cookies are missing - reconnect EA");
  }
  if (!jar.sid || !jar._nx_mpcid) {
    const missing = ["sid", "_nx_mpcid"].filter((n) => !jar[n]);
    throw new Error(
      `EA needs the ${missing.join(" and ")} cookie${missing.length > 1 ? "s" : ""} as well - reconnect EA and copy the whole set`,
    );
  }

  const { status, headers, data } = await httpsRequest(EA_AUTH_URL, {
    headers: {
      Cookie: formatCookieLine(jar),
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
    },
  });

  if (!data || !data.access_token) {
    const code = data?.error || data?.error_code || status;
    if (code === "login_required") {
      throw new Error(
        "EA session has expired - reconnect EA to store a fresh cookie",
      );
    }
    throw new Error(
      `EA auth error: ${status} ${data?.error_description || code}`,
    );
  }

  const rotated = applyRotations(jar, headers["set-cookie"]);

  return {
    accessToken: data.access_token,
    expiresAt: new Date(
      Date.now() + Number(data.expires_in ?? 14400) * 1000,
    ).toISOString(),
    cookies: formatCookieLine(rotated),
    // Only `remid` carries a stated lifetime; `sid` is a session cookie.
    refreshExpiresAt: cookieExpiry(headers["set-cookie"], "remid"),
  };
}

function urlEncode(str) {
  return encodeURIComponent(str);
}

async function eaGraphQL(query, accessToken, variables) {
  let url = `https://${GQL_HOST}/graphql?query=${urlEncode(query)}`;
  if (variables) url += `&variables=${urlEncode(JSON.stringify(variables))}`;
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
  /**
   * Mints a fresh access token from stored EA cookies.
   *
   * Tokens only, deliberately - no identity lookup. `identity` is a connect-time
   * snapshot everywhere in this project and a refresh must never rewrite it.
   */
  async refresh(options = {}) {
    const { cookies, remid, sid } = options;
    return mintFromCookies({ cookies, remid, sid });
  },

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
    const {
      accessToken,
      personaId,
      achievementSetOverride,
      sandboxName,
      raw = false,
    } = options;
    if (!accessToken) throw new Error("accessToken is required");
    if (!personaId) throw new Error("personaId is required");
    if (!achievementSetOverride)
      throw new Error("achievementSetOverride is required");

    const ids = JSON.stringify([achievementSetOverride]);
    const gql = `query{achievements(achievementSetIds:${ids},playerPsd:"${personaId}",showHidden:true){id achievements{id name description howTo awardCount date images{path}}}}`;
    const gqlData = await eaGraphQL(gql, accessToken);
    if (raw) return gqlData;
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
        description: a.description || null,
        howTo: a.howTo || null,
        iconUrl: a.images?.at(-1)?.path || null,
        unlocked: a.awardCount === 1,
        // Locked achievements carry the current time as their date.
        unlockDate: a.awardCount === 1 ? a.date : null,
      })),
    };
  },

  /**
   * Every full game EA lists for the account, from any storefront (EA, and
   * Steam/Epic copies linked to EA) and any ownership method, with playtime
   * and catalogue details merged in. Same request as the EA app's
   * `getPreloadedOwnedGames` (Maxima launcher).
   */
  async library(options = {}) {
    const { accessToken } = options;
    if (!accessToken) throw new Error("accessToken is required");

    const ownedQuery = `query owned($next: String, $ownershipMethods: [OwnershipMethod!]) {
      me {
        ownedGameProducts(storefronts: [EA, STEAM, EPIC], locale: "DEFAULT", paging: {limit: 100, next: $next}, productFound: true, ownershipMethod: $ownershipMethods, type: [DIGITAL_FULL_GAME, PACKAGED_FULL_GAME], downloadableOnly: false, platforms: [PC]) {
          next
          items {
            originOfferId
            product {
              id
              name
              gameSlug
              baseItem(availabilities: [VISIBLE]) { title gameType }
              gameProductUser(storefronts: [EA, STEAM, EPIC]) { ownershipMethods initialEntitlementDate }
            }
          }
        }
      }
    }`;
    const items = [];
    let next = null;
    for (let page = 0; page < 50; page++) {
      const data = await eaGraphQL(ownedQuery, accessToken, {
        next,
        ownershipMethods: OWNERSHIP_METHODS,
      });
      const res = data.me.ownedGameProducts;
      items.push(...res.items);
      // A repeated cursor would loop forever.
      if (!res.next || res.next === next) break;
      next = res.next;
    }
    // Bonus content can come through as a "full game" product.
    const games = items.filter(
      (i) => i.product.baseItem?.gameType !== "MICRO_CONTENT",
    );

    const ptMap = {};
    const slugs = [...new Set(games.map((i) => i.product.gameSlug))].filter(
      Boolean,
    );
    for (let i = 0; i < slugs.length; i += 100) {
      const data = await eaGraphQL(
        `query pt($gameSlugs: [String!]!) { me { recentGames(gameSlugs: $gameSlugs, paging: {limit: 100}) { items { gameSlug lastSessionEndDate totalPlayTimeSeconds } } } }`,
        accessToken,
        { gameSlugs: slugs.slice(i, i + 100) },
      );
      for (const g of data.me.recentGames.items) ptMap[g.gameSlug] = g;
    }

    const offerMap = {};
    const offerIds = games.map((i) => i.originOfferId).filter(Boolean);
    for (let i = 0; i < offerIds.length; i += 100) {
      const data = await eaGraphQL(
        `query offers($offerIds: [String!]!) { legacyOffers(offerIds: $offerIds, locale: "DEFAULT") { offerId: id displayName displayType contentId achievementSetOverride releaseDate } }`,
        accessToken,
        { offerIds: offerIds.slice(i, i + 100) },
      );
      for (const o of data.legacyOffers) offerMap[o.offerId] = o;
    }

    return {
      records: games.map((i) => {
        const meta = offerMap[i.originOfferId] || {};
        const pt = ptMap[i.product.gameSlug];
        const user = i.product.gameProductUser || {};
        // EA sends 1970-01-01 when it has no last-played date.
        const last = pt?.lastSessionEndDate;
        return {
          originOfferId: i.originOfferId,
          productId: i.product.id,
          name: (
            i.product.baseItem?.title ||
            meta.displayName ||
            i.product.name
          ).trim(),
          gameSlug: i.product.gameSlug,
          contentId: meta.contentId || null,
          displayType: meta.displayType || null,
          achievementSetOverride: meta.achievementSetOverride || null,
          ownershipMethods: user.ownershipMethods || [],
          addedDate: user.initialEntitlementDate || null,
          releaseDate: meta.releaseDate || null,
          playtimeSeconds: pt?.totalPlayTimeSeconds ?? null,
          lastPlayedDate: last && Date.parse(last) > 0 ? last : null,
        };
      }),
    };
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

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

module.exports.eaGraphQL = eaGraphQL;
module.exports.actions = actions;
