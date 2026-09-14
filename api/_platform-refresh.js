const https = require("https");
const { exchangeRefreshTokenForAuthTokens } = require("psn-api");

// ---------------------------------------------------------------------------
// Shared HTTP helper - mirrors httpsRequest() in api/epic.js and api/xbox.js.
// Duplicated because those handlers do not export their internals.
// ---------------------------------------------------------------------------
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

function formEncode(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ---------------------------------------------------------------------------
// PSN - mirrors the `auth` action in api/psn.js (refreshToken branch),
// including its expiry computation (now + expiresIn * 1000).
// ---------------------------------------------------------------------------
async function refreshPsn(credentials) {
  if (!credentials || !credentials.refreshToken) {
    throw new Error("psn refreshToken is missing");
  }
  const tokens = await exchangeRefreshTokenForAuthTokens(
    credentials.refreshToken,
  );
  const now = Date.now();
  return {
    credentials: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    expiresAt: new Date(now + tokens.expiresIn * 1000).toISOString(),
    refreshExpiresAt: new Date(
      now + tokens.refreshTokenExpiresIn * 1000,
    ).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Epic - mirrors oauthToken() + the `auth` action refreshToken branch
// in api/epic.js (same launcher client credentials and AUTH_HOST).
// ---------------------------------------------------------------------------
const LAUNCHER_CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a";
const LAUNCHER_CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf";
const AUTH_HOST = "account-public-service-prod03.ol.epicgames.com";

function basicAuth(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function epicOauthToken(params) {
  const { status, data } = await httpsRequest(
    `https://${AUTH_HOST}/account/api/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth(LAUNCHER_CLIENT_ID, LAUNCHER_CLIENT_SECRET),
      },
    },
    formEncode(params),
  );
  if (status !== 200) {
    throw new Error(
      `Epic auth error: ${status} ${data.errorMessage || data.error}`,
    );
  }
  return data;
}

async function refreshEpic(credentials) {
  if (!credentials || !credentials.refreshToken) {
    throw new Error("epic refreshToken is missing");
  }
  const data = await epicOauthToken({
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    token_type: "eg1",
  });
  return {
    credentials: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      epicAccountId: data.account_id,
    },
    expiresAt: data.expires_at ?? null,
    refreshExpiresAt: data.refresh_expires_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Xbox - mirrors refreshMsaToken() -> exchangeMsaForUserToken() ->
// exchangeUserForXsts() in api/xbox.js. Refreshing rotates BOTH the
// xstsToken and the userHash, so all five fields are returned.
// ---------------------------------------------------------------------------
const XBOX_CLIENT_ID = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const XBOX_REDIRECT_URI = "https://login.live.com/oauth20_desktop.srf";

async function refreshMsaToken(refreshToken) {
  const { status, data } = await httpsRequest(
    "https://login.live.com/oauth20_token.srf",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    formEncode({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: XBOX_CLIENT_ID,
      scope: "Xboxlive.signin Xboxlive.offline_access",
      redirect_uri: XBOX_REDIRECT_URI,
    }),
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

async function refreshXbox(credentials) {
  if (!credentials || !credentials.refreshToken) {
    throw new Error("xbox refreshToken is missing");
  }
  const msaTokens = await refreshMsaToken(credentials.refreshToken);
  const userAuth = await exchangeMsaForUserToken(msaTokens.access_token);
  const xstsAuth = await exchangeUserForXsts(userAuth.Token);
  const claims = xstsAuth.DisplayClaims.xui[0];
  return {
    credentials: {
      xuid: claims.xid,
      userHash: claims.uhs,
      xstsToken: xstsAuth.Token,
      accessToken: msaTokens.access_token,
      refreshToken: msaTokens.refresh_token,
    },
    expiresAt: new Date(
      Date.now() + Number(msaTokens.expires_in) * 1000,
    ).toISOString(),
    refreshExpiresAt: null,
  };
}

// ---------------------------------------------------------------------------
// EA - mirrors mintFromCookies() in api/ea.js. EA has no refresh token; what it
// has is a set of session cookies, and trading them for a token is the whole
// mechanism. `sid` + `_nx_mpcid` are the measured minimum - any one of them
// alone is refused - and EA rotates `sid` on nearly every call, so whatever
// comes back MUST be written back. See docs/auth.md.
// ---------------------------------------------------------------------------
const EA_AUTH_URL =
  "https://accounts.ea.com/connect/auth" +
  "?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none";

const EA_COOKIE_NAMES = ["remid", "sid", "_nx_mpcid"];

const EA_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

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
    if (value && value !== "deleted") next[name] = value;
  }
  return next;
}

function cookieExpiry(setCookie, name) {
  for (const line of setCookie ?? []) {
    if (!line.startsWith(`${name}=`)) continue;
    const raw = line.match(/expires=([^;]+)/i)?.[1];
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

async function refreshEa(credentials) {
  const { cookies, remid, sid, personaId, pidId } = credentials ?? {};
  const jar = {
    ...parseCookieLine(cookies),
    ...(remid ? { remid } : {}),
    ...(sid ? { sid } : {}),
  };

  if (!jar.sid || !jar._nx_mpcid) {
    throw new Error("ea cookies are missing or incomplete - reconnect EA");
  }

  const { status, headers, data } = await httpsRequest(EA_AUTH_URL, {
    headers: {
      Cookie: formatCookieLine(jar),
      "User-Agent": EA_BROWSER_UA,
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
    credentials: {
      accessToken: data.access_token,
      cookies: formatCookieLine(rotated),
      // Carried through untouched - losing these would break library calls.
      personaId: personaId ?? null,
      pidId: pidId ?? null,
    },
    expiresAt: new Date(
      Date.now() + Number(data.expires_in ?? 14400) * 1000,
    ).toISOString(),
    refreshExpiresAt: cookieExpiry(headers["set-cookie"], "remid"),
  };
}

const REFRESHERS = {
  psn: refreshPsn,
  epic: refreshEpic,
  xbox: refreshXbox,
  ea: refreshEa,
};

async function refreshPlatform(platform, credentials) {
  const refresher = REFRESHERS[platform];
  if (!refresher) throw new Error(`${platform} cannot be refreshed`);
  return refresher(credentials);
}

/**
 * Whether a stored row actually has something to refresh with.
 *
 * Not simply "has a refreshToken": EA renews from session cookies instead, so
 * the test is per platform. The nightly cron uses this to decide what to skip.
 */
function hasRefreshMaterial(platform, credentials = {}) {
  if (!REFRESHERS[platform]) return false;
  if (platform === "ea") {
    return Boolean(credentials.cookies || credentials.remid || credentials.sid);
  }
  return Boolean(credentials.refreshToken);
}

module.exports = {
  refreshPlatform,
  hasRefreshMaterial,
  REFRESHABLE_PLATFORMS: Object.keys(REFRESHERS),
};
