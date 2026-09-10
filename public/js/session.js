import { supabase } from "./supabase.js";

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

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
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
