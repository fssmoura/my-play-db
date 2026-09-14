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

  // EA needs a SET of cookies, not one value - measured: `sid` and `_nx_mpcid`
  // together are the minimum EA accepts, and `remid` is the long-lived one that
  // should outlive `sid`. Any of them alone is rejected with `login_required`.
  //
  // The input is whatever the user pasted: a "Copy as cURL" blob, a raw cookie
  // header, or a couple of `name=value` lines. All that matters is finding the
  // three names anywhere in it.
  ea: (text) => {
    const wanted = ["remid", "sid", "_nx_mpcid"];
    const found = [];
    for (const name of wanted) {
      // `\b` is no good here - `_nx_mpcid` starts with an underscore, and `sid`
      // would otherwise match inside `PIM-SESSION-ID`. Require a delimiter.
      const m = text.match(new RegExp(`(?:^|[;,\\s'"])${name}=([^;,\\s'"]+)`));
      if (m) found.push(`${name}=${m[1]}`);
    }
    // `sid` is non-negotiable; without it EA rejects the lot.
    return found.some((f) => f.startsWith("sid=")) ? found.join("; ") : null;
  },
};
