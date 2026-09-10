/**
 * Pure credential parsing. No imports, so it can be unit-tested directly.
 *
 * The user copies whatever the platform rendered - usually a JSON blob,
 * sometimes a whole URL, sometimes the bare value. These normalize all of that
 * down to the single string the handler wants, and return null when the text
 * clearly is not the credential, so clipboard polling knows to keep waiting.
 */

export function fromJsonKey(text, key) {
  try {
    const value = JSON.parse(text)?.[key];
    if (typeof value === "string" && value) return value;
  } catch {
    /* not JSON - fall through to the regex */
  }
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text);
  return match ? match[1] : null;
}

export function fromUrlParam(text, param) {
  const match = new RegExp(`[?&#]${param}=([^&\\s"'<]+)`).exec(text);
  return match ? decodeURIComponent(match[1]) : null;
}

export function bare(text, pattern) {
  const trimmed = String(text ?? "").trim();
  return pattern.test(trimmed) ? trimmed : null;
}

export const EXTRACTORS = {
  // {"npsso":"<64 chars>"}
  psn: (text) =>
    fromJsonKey(text, "npsso") ?? bare(text, /^[A-Za-z0-9._-]{40,}$/),

  // SteamID64 - only used as a manual fallback; OpenID is the real path.
  steam: (text) => bare(text, /^\d{17}$/),

  // {"redirectUrl":"...","authorizationCode":"<32 hex>", ...}
  epic: (text) =>
    fromJsonKey(text, "authorizationCode") ??
    fromUrlParam(text, "code") ??
    bare(text, /^[a-f0-9]{32}$/i),

  // Full redirect URL (...oauth20_desktop.srf?code=M.C5...) or the bare code.
  xbox: (text) =>
    fromUrlParam(text, "code") ?? bare(text, /^M\.[A-Za-z0-9._-]{20,}$/),

  // {"access_token":"...","token_type":"Bearer","expires_in":14399}
  ea: (text) =>
    fromJsonKey(text, "access_token") ?? bare(text, /^[A-Za-z0-9._-]{40,}$/),
};
