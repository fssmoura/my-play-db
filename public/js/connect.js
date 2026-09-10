/**
 * Connect flows.
 *
 * Two modes exist, because of a hard browser constraint:
 *
 *  - "openid" (Steam): Steam OpenID lets us set an arbitrary return_to, so the
 *    popup redirects back to OUR origin and we read the identity directly.
 *    Fully automatic.
 *
 *  - "clipboard" (PSN / Epic / Xbox / EA): these endpoints render JSON (or a
 *    dead redirect) on THEIR domain. Same-origin policy means we cannot read a
 *    cross-origin popup's URL or body, so the value physically cannot be
 *    scraped. Best achievable: open the popup already-authenticated, let the
 *    user copy, then auto-ingest from the clipboard the moment they come back.
 */

const POPUP_FEATURES = (w, h) => {
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  return `popup=yes,width=${w},height=${h},left=${Math.max(0, left)},top=${Math.max(0, top)}`;
};

/** Must be called synchronously inside a click handler or the browser blocks it. */
export function openPopup(url, name = "mpdb-connect", w = 620, h = 760) {
  const popup = window.open(url, name, POPUP_FEATURES(w, h));
  if (popup) popup.focus();
  return popup;
}

/* ------------------------------------------------------- redirect mode ---- */

/**
 * Popups are unreliable on mobile. iOS Safari enforces a very short transient
 * activation window (any await between the tap and window.open kills it), and
 * Microsoft/Auth0/Supabase all recommend full-page redirects for mobile web.
 * A same-tab `location.href` assignment cannot be popup-blocked at all.
 *
 * So: redirect mode on small/touch screens, popup mode on desktop.
 */
export function shouldUseRedirect() {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const narrow = window.innerWidth <= 820;
  return Boolean(coarse || narrow);
}

const PENDING_KEY = "mpdb_pending_connect";
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * sessionStorage survives a same-tab cross-origin round trip, but iOS can evict
 * a backgrounded tab. localStorage mirrors it cheaply as insurance. (Safari ITP
 * caps script-writable storage at 7 days, which is irrelevant for a 10-min TTL.)
 */
function writePending(entry) {
  const json = JSON.stringify(entry);
  try {
    sessionStorage.setItem(PENDING_KEY, json);
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem(PENDING_KEY, json);
  } catch {
    /* private mode */
  }
}

function readPending() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(PENDING_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function newState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Navigates the current tab to Steam. Everything here is synchronous - no
 * awaits before the navigation, which is what keeps iOS happy.
 */
export function beginSteamRedirect() {
  const state = newState();
  writePending({ platform: "steam", state, createdAt: Date.now() });
  window.location.href = steamOpenIdUrl(
    `${window.location.origin}/?mpdb_state=${state}`,
  );
}

/**
 * Called on every app boot. Returns { platform, params } when we've just come
 * back from a redirect, else null. Always cleans the URL with replaceState so
 * the credential never sits in browser history.
 */
export function consumePendingRedirect() {
  const query = new URLSearchParams(window.location.search);
  if (!query.get("openid.mode")) return null;

  const cleanUrl = () =>
    window.history.replaceState(null, "", window.location.pathname);

  const pending = readPending();
  clearPending();
  cleanUrl();

  if (!pending) return { error: "No pending connection was found." };
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    return { error: "That sign-in took too long. Please try again." };
  }
  if (query.get("mpdb_state") !== pending.state) {
    return { error: "Sign-in state mismatch. Please try again." };
  }

  const params = {};
  for (const [key, value] of query.entries()) {
    if (key.startsWith("openid.")) params[key] = value;
  }
  return { platform: pending.platform, params };
}

/* ---------------------------------------------------------------- Steam ---- */

export function steamOpenIdUrl(
  returnTo = `${window.location.origin}/steam-callback.html`,
) {
  const origin = window.location.origin;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": `${origin}/`,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `https://steamcommunity.com/openid/login?${params}`;
}

/**
 * Waits for steam-callback.html to postMessage the openid params back.
 * Resolves with the raw params object.
 */
export function awaitSteamOpenId(popup, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closedTimer);
      clearTimeout(timeoutTimer);
      fn(arg);
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "steam-openid") return;
      finish(resolve, event.data.params);
    };

    window.addEventListener("message", onMessage);

    // If the user closes the popup manually, stop waiting.
    const closedTimer = setInterval(() => {
      if (popup && popup.closed) {
        finish(reject, new Error("Steam sign-in window was closed."));
      }
    }, 500);

    const timeoutTimer = setTimeout(() => {
      finish(reject, new Error("Steam sign-in timed out."));
    }, timeoutMs);
  });
}

/* ------------------------------------------------------------ Clipboard ---- */

/**
 * Resolves with clipboard text once the user returns to our window.
 *
 * navigator.clipboard.readText() requires the document to be focused AND a
 * user gesture in some browsers, so this is best-effort: the caller must
 * always keep a manual paste field available as a fallback.
 */
export function awaitClipboardCredential(
  popup,
  extract,
  { timeoutMs = 300000 } = {},
) {
  return new Promise((resolve, reject) => {
    let done = false;
    let attempts = 0;

    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      window.removeEventListener("focus", tryRead);
      clearInterval(poll);
      clearTimeout(timeoutTimer);
      fn(arg);
    };

    async function tryRead() {
      if (done) return;
      attempts += 1;
      if (!document.hasFocus()) return;
      try {
        const text = await navigator.clipboard.readText();
        const value = extract(text);
        if (value) {
          if (popup && !popup.closed) popup.close();
          finish(resolve, value);
        }
      } catch {
        // Permission denied or unfocused - the manual field covers this.
        if (attempts > 3 && !navigator.clipboard) {
          finish(reject, new Error("Clipboard access is unavailable."));
        }
      }
    }

    window.addEventListener("focus", tryRead);
    const poll = setInterval(tryRead, 1000);
    const timeoutTimer = setTimeout(() => {
      finish(reject, new Error("Timed out waiting for the credential."));
    }, timeoutMs);
  });
}

/** Cancels an in-flight clipboard wait by resolving nothing. */
export function closePopup(popup) {
  try {
    if (popup && !popup.closed) popup.close();
  } catch {
    /* cross-origin popups may refuse; ignore */
  }
}
