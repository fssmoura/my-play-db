const https = require("https");
const { setCorsHeaders, handlePreflight } = require("./_cors");

const XBOX_CLIENT_ID = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const REDIRECT_URI = "https://login.live.com/oauth20_desktop.srf";

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

function formEncode(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function exchangeCodeForMsaToken(code) {
  const body = formEncode({
    grant_type: "authorization_code",
    code,
    scope: "Xboxlive.signin Xboxlive.offline_access",
    client_id: XBOX_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  });
  const { status, data } = await httpsRequest(
    "https://login.live.com/oauth20_token.srf",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    body,
  );
  if (status !== 200) {
    throw new Error(
      `MSA token error: ${status} ${data.error_description || data.error}`,
    );
  }
  return data;
}

async function refreshMsaToken(refreshToken) {
  const body = formEncode({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: XBOX_CLIENT_ID,
    scope: "Xboxlive.signin Xboxlive.offline_access",
    redirect_uri: REDIRECT_URI,
  });
  const { status, data } = await httpsRequest(
    "https://login.live.com/oauth20_token.srf",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    body,
  );
  if (status !== 200) {
    throw new Error(
      `MSA refresh error: ${status} ${data.error_description || data.error}`,
    );
  }
  return data;
}

async function exchangeMsaForUserToken(msaAccessToken) {
  const { status, data } = await httpsRequest(
    "https://user.auth.xboxlive.com/user/authenticate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-xbl-contract-version": "1",
      },
    },
    JSON.stringify({
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msaAccessToken}`,
      },
    }),
  );
  if (status !== 200) {
    throw new Error(
      `User token error: ${status} ${data.error_description || data.error || JSON.stringify(data)}`,
    );
  }
  return data;
}

async function exchangeUserForXsts(userToken) {
  const { status, data } = await httpsRequest(
    "https://xsts.auth.xboxlive.com/xsts/authorize",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-xbl-contract-version": "1",
      },
    },
    JSON.stringify({
      RelyingParty: "http://xboxlive.com",
      TokenType: "JWT",
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [userToken],
      },
    }),
  );
  if (status !== 200) {
    throw new Error(
      `XSTS error: ${status} ${data.error_description || data.error || JSON.stringify(data)}`,
    );
  }
  return data;
}

async function xboxGet(url, userHash, xstsToken) {
  const { status, data } = await httpsRequest(url, {
    headers: {
      Authorization: `XBL3.0 x=${userHash};${xstsToken}`,
      "x-xbl-contract-version": "2",
      "Accept-Language": "en-US",
    },
  });
  if (status !== 200) {
    throw new Error(
      `Xbox API error: ${status} ${data.error_description || data.error || JSON.stringify(data)}`,
    );
  }
  return data;
}

const actions = {
  async auth(options = {}) {
    const { authorizationCode, refreshToken } = options;
    let msaTokens;
    if (refreshToken) {
      msaTokens = await refreshMsaToken(refreshToken);
    } else if (authorizationCode) {
      msaTokens = await exchangeCodeForMsaToken(authorizationCode);
    } else {
      throw new Error("authorizationCode or refreshToken is required");
    }
    const userAuth = await exchangeMsaForUserToken(msaTokens.access_token);
    const xstsAuth = await exchangeUserForXsts(userAuth.Token);
    const claims = xstsAuth.DisplayClaims.xui[0];
    return {
      xuid: claims.xid,
      gamertag: claims.gtg,
      userHash: claims.uhs,
      xstsToken: xstsAuth.Token,
      accessToken: msaTokens.access_token,
      refreshToken: msaTokens.refresh_token,
      expiresIn: msaTokens.expires_in,
    };
  },

  async profile(options = {}) {
    const { xuid, userHash, xstsToken } = options;
    if (!xuid || !userHash || !xstsToken) {
      throw new Error("xuid, userHash, and xstsToken are required");
    }
    const { status, data } = await httpsRequest(
      "https://profile.xboxlive.com/users/batch/profile/settings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-xbl-contract-version": "2",
          Authorization: `XBL3.0 x=${userHash};${xstsToken}`,
        },
      },
      JSON.stringify({
        userIds: [xuid],
        settings: [
          "GameDisplayName",
          "GameDisplayPicRaw",
          "Gamerscore",
          "Gamertag",
        ],
      }),
    );
    if (status !== 200) {
      throw new Error(
        `Profile error: ${status} ${data.error_description || JSON.stringify(data)}`,
      );
    }
    return data;
  },

  async games(options = {}) {
    const { xuid, userHash, xstsToken } = options;
    if (!xuid || !userHash || !xstsToken) {
      throw new Error("xuid, userHash, and xstsToken are required");
    }
    const titleHistory = await xboxGet(
      `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/detail`,
      userHash,
      xstsToken,
    );
    const titles = titleHistory.titles ?? [];
    const titleIds = titles.map((t) => t.titleId).filter(Boolean);
    if (titleIds.length > 0) {
      const stats = titleIds.map((id) => ({
        name: "MinutesPlayed",
        titleid: id,
      }));
      const { status: ptStatus, data: ptData } = await httpsRequest(
        "https://userstats.xboxlive.com/batch",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-xbl-contract-version": "2",
            Authorization: `XBL3.0 x=${userHash};${xstsToken}`,
          },
        },
        JSON.stringify({
          arrangebyfield: "xuid",
          stats,
          xuids: [xuid],
        }),
      );
      if (ptStatus === 200 && ptData.statlistscollection?.[0]?.stats) {
        const ptMap = {};
        for (const s of ptData.statlistscollection[0].stats) {
          ptMap[s.titleid] = parseInt(s.value, 10) || 0;
        }
        for (const t of titles) {
          if (ptMap[t.titleId] != null) t.minutesPlayed = ptMap[t.titleId];
        }
      }
    }
    return titleHistory;
  },

  async achievements(options = {}) {
    const { xuid, userHash, xstsToken, titleId } = options;
    if (!xuid || !userHash || !xstsToken) {
      throw new Error("xuid, userHash, and xstsToken are required");
    }
    if (!titleId) throw new Error("titleId is required");
    return await xboxGet(
      `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=1000`,
      userHash,
      xstsToken,
    );
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
