import { supabase } from "/js/supabase.js";

/** Resolves once the initial session has been restored / parsed from the URL. */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(handler) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    handler(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(next = null) {
  const redirectTo = next
    ? `${window.location.origin}/?next=${encodeURIComponent(next)}`
    : `${window.location.origin}/`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}

// Local preview only: an explicit sign-out stops auto sign-in for this tab.
export const NO_DEV_SIGNIN_KEY = "no-dev-signin";

export async function signOut() {
  try {
    sessionStorage.setItem(NO_DEV_SIGNIN_KEY, "1");
  } catch {}
  await supabase.auth.signOut();
}

// Local preview only (localhost): asks /api/dev-signin, which 404s anywhere
// else, for tokens and adopts them. Resolves false on any failure, silently.
export async function tryDevSignIn() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!local) return false;
  try {
    if (sessionStorage.getItem(NO_DEV_SIGNIN_KEY)) return false;
    const response = await fetch("/api/dev-signin", { method: "POST" });
    if (!response.ok) return false;
    const { access_token, refresh_token } = await response.json();
    if (!access_token || !refresh_token) return false;
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
}

/**
 * Current Supabase JWT, used as the bearer token for /api/* calls.
 * supabase-js refreshes this automatically, so always read it fresh.
 */
export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token ?? null;
}

/**
 * OAuth failures come back as query/hash params on the redirect, not as a
 * thrown error. The DB trigger rejects non-owner signups with "signup is
 * closed", which surfaces here.
 */
export function readAuthErrorFromUrl() {
  const fromHash = new URLSearchParams(window.location.hash.slice(1));
  const fromQuery = new URLSearchParams(window.location.search);
  const description =
    fromHash.get("error_description") ?? fromQuery.get("error_description");
  if (!description) return null;

  window.history.replaceState({}, "", window.location.pathname);
  if (/signup is closed|Database error saving new user/i.test(description)) {
    return "This app is locked to a single owner account, and that account already exists.";
  }
  return description;
}
