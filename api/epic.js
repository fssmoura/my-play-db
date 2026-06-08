const https = require("https");
const { setCorsHeaders, handlePreflight } = require("./_cors");

const LAUNCHER_CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a";
const LAUNCHER_CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf";
const AUTH_HOST = "account-public-service-prod03.ol.epicgames.com";
const LIBRARY_HOST = "library-service.live.use1a.on.epicgames.com";
const CATALOG_HOST = "catalog-public-service-prod06.ol.epicgames.com";
const GQL_HOST = "launcher.store.epicgames.com";

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

function basicAuth(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function oauthToken(params) {
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const { status, data } = await httpsRequest(
    `https://${AUTH_HOST}/account/api/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth(LAUNCHER_CLIENT_ID, LAUNCHER_CLIENT_SECRET),
      },
    },
    body,
  );
  if (status !== 200) {
    throw new Error(
      `Epic auth error: ${status} ${data.errorMessage || data.error}`,
    );
  }
  return data;
}

async function epicFetch(url, accessToken) {
  const { status, data } = await httpsRequest(url, {
    headers: { Authorization: `bearer ${accessToken}` },
  });
  if (status !== 200) {
    const msg = data.errorMessage || data.error || status;
    throw new Error(`Epic API error: ${status} ${msg}`);
  }
  return data;
}

function epicGraphQL(body, accessToken) {
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher",
    };
    if (accessToken) headers["Authorization"] = "bearer " + accessToken;
    const opts = {
      hostname: GQL_HOST,
      path: "/graphql",
      method: "POST",
      headers,
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
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function resolveAccountId(options) {
  if (options.epicAccountId) return options.epicAccountId;
  if (options.refreshToken) {
    const auth = await oauthToken({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      token_type: "eg1",
    });
    return auth.account_id;
  }
  if (options.accessToken) {
    try {
      const { data } = await httpsRequest(
        `https://${AUTH_HOST}/account/api/oauth/verify`,
        {
          headers: { Authorization: `bearer ${options.accessToken}` },
        },
      );
      return data.account_id || null;
    } catch {
      return null;
    }
  }
  return null;
}

const actions = {
  async auth(options = {}) {
    const { authorizationCode, refreshToken } = options;
    if (refreshToken) {
      return oauthToken({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        token_type: "eg1",
      });
    }
    if (!authorizationCode) {
      throw new Error("authorizationCode or refreshToken is required");
    }
    return oauthToken({
      grant_type: "authorization_code",
      code: authorizationCode,
      token_type: "eg1",
    });
  },

  async library(options = {}) {
    const { accessToken, resolveNames } = options;
    if (!accessToken) throw new Error("accessToken is required");
    const accountId = await resolveAccountId(options);
    const records = [];
    let cursor = null;
    while (true) {
      const params = new URLSearchParams({ includeMetadata: "true" });
      if (cursor) params.set("cursor", cursor);
      const url = `https://${LIBRARY_HOST}/library/api/public/items?${params}`;
      const data = await epicFetch(url, accessToken);
      records.push(...(data.records ?? []));
      cursor = data.responseMetadata?.nextCursor ?? null;
      if (!cursor) break;
    }
    const playtime = await epicFetch(
      `https://${LIBRARY_HOST}/library/api/public/playtime/account/${accountId}/all`,
      accessToken,
    ).catch(() => []);
    const ptMap = {};
    if (Array.isArray(playtime)) {
      for (const p of playtime) ptMap[p.artifactId] = p.totalTime;
    }
    // Deduplicate by namespace for metadata.
    // Track playtime per-appName within each namespace.
    // When a namespace has multiple artifacts with playtime (e.g. fn: Fortnite + Rocket Racing),
    // split into separate entries rather than summing.
    const nsMap = {};
    for (const r of records) {
      if (!r.namespace) continue;
      const ns = r.namespace;
      if (!nsMap[ns]) {
        nsMap[ns] = {
          namespace: ns,
          catalogItemId: null,
          sandboxName: null,
          appName: null,
          productId: null,
          sandboxType: null,
          acquisitionDate: null,
          _ptByApp: {},
          platforms: [],
        };
      }
      const e = nsMap[ns];
      if (!e.catalogItemId && r.catalogItemId)
        e.catalogItemId = r.catalogItemId;
      if (r.appName && !e.appName) e.appName = r.appName;
      if (!e.productId && r.productId) e.productId = r.productId;
      if (!e.sandboxType && r.sandboxType) e.sandboxType = r.sandboxType;
      if (!e.acquisitionDate && r.acquisitionDate)
        e.acquisitionDate = r.acquisitionDate;
      if (r.sandboxName && !e.sandboxName) e.sandboxName = r.sandboxName;
      if (r.appName && ptMap[r.appName] != null) {
        if (!e._ptByApp[r.appName]) e._ptByApp[r.appName] = 0;
        e._ptByApp[r.appName] += ptMap[r.appName];
      }
      if (r.platform) {
        for (const p of Array.isArray(r.platform) ? r.platform : [r.platform]) {
          if (!e.platforms.includes(p)) e.platforms.push(p);
        }
      }
    }
    // Split namespaces with multiple playtime artifacts
    const result = [];
    for (const entry of Object.values(nsMap)) {
      const appNames = Object.keys(entry._ptByApp);
      const ptByApp = entry._ptByApp;
      delete entry._ptByApp;
      if (appNames.length <= 1) {
        if (appNames.length === 1) entry.playtime = ptByApp[appNames[0]];
        if (entry.playtime === 0) delete entry.playtime;
        result.push(entry);
      } else {
        for (const appName of appNames) {
          const e = {
            namespace: entry.namespace,
            catalogItemId: entry.catalogItemId,
            sandboxName: entry.sandboxName,
            appName: appName,
            productId: entry.productId,
            sandboxType: entry.sandboxType,
            acquisitionDate: entry.acquisitionDate,
            playtime: ptByApp[appName],
            platforms: entry.platforms,
          };
          if (e.playtime === 0) delete e.playtime;
          result.push(e);
        }
      }
    }
    if (resolveNames) {
      const catItems = result
        .filter((r) => r.catalogItemId)
        .map((r) => ({
          namespace: r.namespace,
          catalogItemId: r.catalogItemId,
        }));
      if (catItems.length > 0) {
        const catResults = await this.catalog({ accessToken, items: catItems });
        for (const r of result) {
          const match = catResults.find(
            (c) => c.namespace === r.namespace || c.id === r.catalogItemId,
          );
          if (match?.title) r.sandboxName = match.title;
        }
      }
    }
    return { records: result };
  },

  async catalog(options = {}) {
    const { accessToken, items } = options;
    if (!accessToken) throw new Error("accessToken is required");
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("items[] is required");
    }
    const byNamespace = {};
    for (const item of items) {
      if (!byNamespace[item.namespace]) byNamespace[item.namespace] = [];
      byNamespace[item.namespace].push(item.catalogItemId);
    }
    const results = [];
    for (const [namespace, ids] of Object.entries(byNamespace)) {
      const params = new URLSearchParams();
      for (const id of ids) params.append("id", id);
      params.set("includeDLCDetails", "true");
      params.set("includeMainGameDetails", "true");
      params.set("country", "PT");
      params.set("locale", "en");
      const url = `https://${CATALOG_HOST}/catalog/api/shared/namespace/${namespace}/bulk/items?${params}`;
      const data = await epicFetch(url, accessToken);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const inner =
          item && typeof item === "object" ? Object.values(item)[0] : null;
        results.push(inner || item);
      }
    }
    return results;
  },

  async progress(options = {}) {
    const { accessToken, sandboxIds, names, resolveNames } = options;
    if (!accessToken) throw new Error("accessToken is required");
    const accountId = await resolveAccountId(options);
    let namespaces = sandboxIds;
    const libMeta = {};
    if (!namespaces || !Array.isArray(namespaces)) {
      const lib = await this.library(options);
      const seen = new Set();
      namespaces = [];
      for (const r of lib.records) {
        if (!r.namespace || seen.has(r.namespace)) continue;
        seen.add(r.namespace);
        namespaces.push(r.namespace);
        libMeta[r.namespace] = {
          sandboxName: r.sandboxName || null,
          catalogItemId: r.catalogItemId || null,
        };
      }
    }
    // Merge optional names map into libMeta
    if (names && typeof names === "object") {
      for (const [ns, info] of Object.entries(names)) {
        if (typeof info === "string") {
          libMeta[ns] = {
            sandboxName: info,
            catalogItemId: libMeta[ns]?.catalogItemId || null,
          };
        } else if (info && typeof info === "object") {
          libMeta[ns] = {
            sandboxName: info.sandboxName || null,
            catalogItemId: info.catalogItemId || null,
          };
        }
      }
    }
    const schemaResults = await Promise.allSettled(
      namespaces.map((ns) =>
        epicGraphQL({
          operationName: "Achievement",
          variables: { SandboxId: ns, Locale: "en-US" },
          query: `query Achievement($SandboxId: String!, $Locale: String!) { Achievement { productAchievementsRecordBySandbox(sandboxId: $SandboxId, locale: $Locale) { productId sandboxId totalAchievements totalProductXP achievementSets { achievementSetId isBase totalAchievements totalXP } } } }`,
        }),
      ),
    );
    const withAch = [];
    for (let i = 0; i < namespaces.length; i++) {
      const r = schemaResults[i];
      if (r.status !== "fulfilled") continue;
      const schemaData =
        r.value.data?.data?.Achievement?.productAchievementsRecordBySandbox;
      if (schemaData && schemaData.totalAchievements > 0) {
        withAch.push({ ns: namespaces[i], schemaData });
      }
    }
    if (withAch.length === 0) return [];
    const playerResults = await Promise.allSettled(
      withAch.map(({ ns }) =>
        epicGraphQL(
          {
            operationName: "PlayerAchievement",
            variables: {
              epicAccountId: accountId,
              sandboxId: ns,
            },
            query: `query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) { PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) { records { totalXP totalUnlocked achievementSets { achievementSetId isBase totalUnlocked totalXP } } } } }`,
          },
          accessToken,
        ),
      ),
    );
    const result = withAch.map(({ schemaData }, i) => {
      const playerRes = playerResults[i];
      let records = null;
      if (playerRes.status === "fulfilled") {
        records =
          playerRes.value.data?.data?.PlayerAchievement
            ?.playerAchievementGameRecordsBySandbox?.records;
      }
      const playerData = records?.[0] || null;
      const meta = libMeta[schemaData.sandboxId] || {};
      return {
        sandboxId: schemaData.sandboxId,
        productId: schemaData.productId,
        sandboxName: meta.sandboxName || null,
        catalogItemId: meta.catalogItemId || null,
        totalAchievements: schemaData.totalAchievements,
        totalXP: schemaData.totalProductXP,
        totalUnlocked: playerData?.totalUnlocked ?? 0,
        earnedXP: playerData?.totalXP ?? 0,
        achievementSets: (schemaData.achievementSets || []).map((s) => {
          const ps = (playerData?.achievementSets || []).find(
            (p) => p.achievementSetId === s.achievementSetId,
          );
          return {
            achievementSetId: s.achievementSetId,
            isBase: s.isBase,
            totalAchievements: s.totalAchievements,
            totalXP: s.totalXP,
            totalUnlocked: ps?.totalUnlocked ?? 0,
            earnedXP: ps?.totalXP ?? 0,
          };
        }),
      };
    });
    if (resolveNames) {
      const catItems = result
        .filter((r) => r.catalogItemId)
        .map((r) => ({
          namespace: r.sandboxId,
          catalogItemId: r.catalogItemId,
        }));
      if (catItems.length > 0) {
        const catResults = await this.catalog({ accessToken, items: catItems });
        for (const r of result) {
          const match = catResults.find(
            (c) => c.namespace === r.sandboxId || c.id === r.catalogItemId,
          );
          if (match?.title) r.sandboxName = match.title;
        }
      }
    }
    return result;
  },

  async achievements(options = {}) {
    const { accessToken, sandboxId, sandboxName, catalogItemId } = options;
    if (!accessToken) throw new Error("accessToken is required");
    if (!sandboxId) throw new Error("sandboxId is required");
    const accountId = await resolveAccountId(options);
    if (!accountId)
      throw new Error("epicAccountId or refreshToken is required");
    const [schemaRes, playerRes] = await Promise.all([
      epicGraphQL({
        operationName: "Achievement",
        variables: { SandboxId: sandboxId, Locale: "en-US" },
        query: `query Achievement($SandboxId: String!, $Locale: String!) { Achievement { productAchievementsRecordBySandbox(sandboxId: $SandboxId, locale: $Locale) { productId sandboxId totalAchievements totalProductXP achievementSets { achievementSetId isBase totalAchievements totalXP } achievements { achievement { name unlockedDisplayName lockedDisplayName unlockedIconLink lockedIconLink XP rarity { percent } } } } } }`,
      }),
      epicGraphQL(
        {
          operationName: "PlayerAchievement",
          variables: { epicAccountId: accountId, sandboxId: sandboxId },
          query: `query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) { PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) { records { totalXP totalUnlocked achievementSets { achievementSetId isBase totalUnlocked totalXP } playerAchievements { playerAchievement { achievementName unlocked unlockDate XP achievementSetId isBase } } } } } }`,
        },
        accessToken,
      ),
    ]);
    const schemaData =
      schemaRes.data?.data?.Achievement?.productAchievementsRecordBySandbox;
    if (!schemaData)
      throw new Error("No achievements configured for this sandboxId");
    const records =
      playerRes.data?.data?.PlayerAchievement
        ?.playerAchievementGameRecordsBySandbox?.records;
    const playerData = records?.[0] || null;
    const playerMap = {};
    if (playerData?.playerAchievements) {
      for (const pa of playerData.playerAchievements) {
        playerMap[pa.playerAchievement.achievementName] = pa.playerAchievement;
      }
    }
    return {
      sandboxId: schemaData.sandboxId,
      productId: schemaData.productId,
      sandboxName: sandboxName || null,
      catalogItemId: catalogItemId || null,
      totalAchievements: schemaData.totalAchievements,
      totalXP: schemaData.totalProductXP,
      totalUnlocked: playerData?.totalUnlocked ?? 0,
      earnedXP: playerData?.totalXP ?? 0,
      achievementSets: (schemaData.achievementSets || []).map((s) => {
        const ps = (playerData?.achievementSets || []).find(
          (p) => p.achievementSetId === s.achievementSetId,
        );
        return {
          achievementSetId: s.achievementSetId,
          isBase: s.isBase,
          totalAchievements: s.totalAchievements,
          totalXP: s.totalXP,
          totalUnlocked: ps?.totalUnlocked ?? 0,
          earnedXP: ps?.totalXP ?? 0,
        };
      }),
      achievements: (schemaData.achievements || []).map((a) => {
        const pa = playerMap[a.achievement.name];
        return {
          name: a.achievement.name,
          displayName: a.achievement.unlockedDisplayName,
          displayNameLocked: a.achievement.lockedDisplayName,
          iconUnlocked: a.achievement.unlockedIconLink,
          iconLocked: a.achievement.lockedIconLink,
          XP: a.achievement.XP,
          rarity: a.achievement.rarity?.percent ?? null,
          unlocked: pa?.unlocked ?? false,
          unlockDate: pa?.unlockDate ?? null,
          achievementSetId: pa?.achievementSetId ?? null,
          isBase: pa?.isBase ?? null,
        };
      }),
    };
  },
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  let raw;
  if (req.method === "GET") {
    raw = req.query;
  } else {
    try {
      raw = req.body;
    } catch {
      const text = await readBody(req);
      try {
        raw = text ? JSON.parse(text) : {};
      } catch {
        raw = {};
      }
    }
  }
  const body = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      try {
        body[key] = JSON.parse(raw[key]);
      } catch {
        body[key] = raw[key];
      }
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
