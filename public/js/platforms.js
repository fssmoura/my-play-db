import { call } from "./api.js";
import { EXTRACTORS } from "./credentials.js";

/**
 * One definition per platform, covering three concerns:
 *   1. how to obtain the credential (authUrl + what the user pastes)
 *   2. how to turn that into a normalized vault record (connect/refresh)
 *   3. which credentials to inject into ordinary data calls
 *
 * The normalization matters: each platform reports expiry differently.
 *   PSN   -> ISO strings for both access and refresh
 *   Epic  -> expires_at / refresh_expires_at (ISO, snake_case)
 *   Xbox  -> expiresIn seconds only, so we compute the timestamp
 *   EA    -> nothing at all, so we assume ~4h
 *   Steam -> never expires
 */

const hoursFromNow = (h) =>
  new Date(Date.now() + h * 3600 * 1000).toISOString();
const secondsFromNow = (s) => new Date(Date.now() + s * 1000).toISOString();

export const PLATFORMS = {
  psn: {
    label: "PlayStation Network",
    credentialLabel: "NPSSO",
    authUrl: "https://ca.account.sony.com/api/v1/ssocookie",
    // Sony has NO login-then-redirect URL. `ssocookie` is a bare API endpoint
    // that 400s with {"error":"invalid_grant"} when signed out, and the OAuth
    // authorize endpoint only accepts Sony's own whitelisted redirect_uri
    // (a custom app scheme a browser cannot render). Every open-source tool
    // (psn-api, PSNAWP) tells users the same two manual steps, so the UI offers
    // a sign-in step explicitly instead of pretending it is one click.
    loginUrl: "https://www.playstation.com/",
    loginLabel: "Sign in to PlayStation",
    canRefresh: true,
    connectMode: "clipboard",
    extract: EXTRACTORS.psn,
    actions: ["profile", "games", "titles", "recent", "trophymap", "trophies"],
    callCredentials: (r) => ({ accessToken: r.credentials.accessToken }),

    async connect(npsso) {
      const t = await call("psn", "auth", {}, { npsso: npsso.trim() });
      return {
        credentials: {
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
        },
        expiresAt: t.accessTokenExpiry ?? null,
        refreshExpiresAt: t.refreshTokenExpiry ?? null,
      };
    },

    async refresh(record) {
      const t = await call(
        "psn",
        "auth",
        {},
        { refreshToken: record.credentials.refreshToken },
      );
      return {
        credentials: {
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
        },
        expiresAt: t.accessTokenExpiry ?? null,
        refreshExpiresAt: t.refreshTokenExpiry ?? null,
      };
    },

    async identify(record) {
      const p = await call("psn", "profile", {}, this.callCredentials(record));
      return {
        name: p?.profile?.onlineId ?? null,
        accountId: p?.profile?.accountId ?? null,
      };
    },
  },

  steam: {
    label: "Steam",
    credentialLabel: "Steam ID (64-bit)",
    authUrl: "https://steamcommunity.com/id/xoura07?xml=1",
    canRefresh: false,
    neverExpires: true,
    // Steam OpenID accepts an arbitrary return_to, so this one is fully automatic.
    connectMode: "openid",
    extract: EXTRACTORS.steam,
    actions: ["profile", "games", "recent", "game", "schemas", "achievements"],
    callCredentials: (r) => ({ steamId: r.credentials.steamId }),

    async connect(steamId) {
      const id = steamId.trim();
      // No token exchange exists; validate the id by actually resolving a profile.
      const res = await call("steam", "profile", { steamId: id });
      const player = res?.response?.players?.[0];
      if (!player) throw new Error("Steam returned no profile for that ID.");
      return {
        credentials: { steamId: id },
        identity: { name: player.personaname, accountId: player.steamid },
        expiresAt: null,
        refreshExpiresAt: null,
      };
    },
  },

  epic: {
    label: "Epic Games",
    credentialLabel: "authorizationCode",
    authUrl:
      // Wrapped in Epic's own login page so this works when signed out too:
      // if a session already exists it passes straight through to the redirect
      // target. This is byte-for-byte what Legendary's EPCAPI.get_auth_url()
      // builds (legendary/api/egs.py), and what legendary.gl/epiclogin 302s to.
      "https://www.epicgames.com/id/login?redirectUrl=" +
      encodeURIComponent(
        "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code",
      ),
    canRefresh: true,
    connectMode: "clipboard",
    extract: EXTRACTORS.epic,
    actions: ["library", "catalog", "progress", "achievements"],
    // Always send epicAccountId: without it the handler burns a token refresh
    // just to look the account id up.
    callCredentials: (r) => ({
      accessToken: r.credentials.accessToken,
      epicAccountId: r.credentials.epicAccountId,
    }),

    async connect(authorizationCode) {
      return normalizeEpic(
        await call("epic", "auth", {
          authorizationCode: authorizationCode.trim(),
        }),
      );
    },

    async refresh(record) {
      return normalizeEpic(
        await call("epic", "auth", {
          refreshToken: record.credentials.refreshToken,
        }),
      );
    },
  },

  xbox: {
    label: "Xbox",
    credentialLabel: "authorizationCode",
    authUrl:
      "https://login.live.com/oauth20_authorize.srf?client_id=38cd2fa8-66fd-4760-afb2-405eb65d5b0c&response_type=code&approval_prompt=auto&scope=Xboxlive.signin%20Xboxlive.offline_access&redirect_uri=https://login.live.com/oauth20_desktop.srf",
    canRefresh: true,
    connectMode: "clipboard",
    // Accepts the full redirect URL or the bare code.
    extract: EXTRACTORS.xbox,
    actions: ["profile", "games", "achievements"],
    callCredentials: (r) => ({
      xuid: r.credentials.xuid,
      userHash: r.credentials.userHash,
      xstsToken: r.credentials.xstsToken,
    }),

    async connect(authorizationCode) {
      return normalizeXbox(
        await call("xbox", "auth", {
          authorizationCode: authorizationCode.trim(),
        }),
      );
    },

    async refresh(record) {
      return normalizeXbox(
        await call("xbox", "auth", {
          refreshToken: record.credentials.refreshToken,
        }),
      );
    },
  },

  ea: {
    label: "EA",
    credentialLabel: "access_token",
    authUrl:
      // `prompt=none` is REQUIRED here. ORIGIN_JS_SDK is a JS-SDK client that is
      // only allowed to mint a token from an EXISTING ea.com session; driving an
      // interactive login through it fails with "Service limitations apply".
      // So: sign in via loginUrl first, then this returns the token silently.
      "https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none",
    loginUrl: "https://www.ea.com/login",
    loginLabel: "Sign in to EA",
    canRefresh: false,
    connectMode: "clipboard",
    extract: EXTRACTORS.ea,
    actions: ["library", "achievements"],
    callCredentials: (r) => ({
      accessToken: r.credentials.accessToken,
      personaId: r.credentials.personaId,
    }),

    async connect(accessToken) {
      const t = await call("ea", "auth", { accessToken: accessToken.trim() });
      return {
        credentials: {
          accessToken: t.accessToken,
          personaId: t.personaId,
          pidId: t.pidId,
        },
        identity: { name: t.displayName, accountId: t.pidId },
        // EA reports no expiry whatsoever; 4h is the observed lifetime.
        expiresAt: hoursFromNow(4),
        refreshExpiresAt: null,
      };
    },
  },
};

function normalizeEpic(t) {
  return {
    credentials: {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      epicAccountId: t.account_id,
    },
    identity: { name: t.displayName, accountId: t.account_id },
    expiresAt: t.expires_at ?? null,
    refreshExpiresAt: t.refresh_expires_at ?? null,
  };
}

function normalizeXbox(t) {
  return {
    // Refreshing Xbox rotates xstsToken AND userHash, not just the token,
    // so the whole tuple has to be re-persisted every time.
    credentials: {
      xuid: t.xuid,
      userHash: t.userHash,
      xstsToken: t.xstsToken,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
    },
    identity: { name: t.gamertag, accountId: t.xuid },
    expiresAt: t.expiresIn ? secondsFromNow(t.expiresIn) : hoursFromNow(1),
    refreshExpiresAt: null,
  };
}

/** Platforms reachable from the console that need no user credentials at all. */
export const KEYLESS_PLATFORMS = {
  igdb: { label: "IGDB", actions: ["auth", "search", "game", "by_external"] },
  sgdb: {
    label: "SteamGridDB",
    actions: ["search", "game", "grids", "heroes", "logos"],
  },
};
