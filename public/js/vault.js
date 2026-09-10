import { supabase } from "./supabase.js";

/**
 * Cross-device store for platform ACCESS credentials.
 *
 * Scope is deliberately narrow: this table exists to keep tokens valid so the
 * integrations never break. It is not a profile store.
 *
 *   credentials   the tokens themselves
 *   identity      connect-time snapshot ({ name, accountId }) purely so one
 *                 account's credential can be told from another's. Never
 *                 rewritten by a refresh - display data (usernames, avatars,
 *                 trophy summaries) belongs in a separate profiles table.
 *   expires_at    when the access token dies
 *   refresh_*     when the refresh token dies (null = no refresh available)
 *   last_refresh_*  health of the automatic refresh
 *
 * RLS scopes every row to auth.uid(), so this is safe to run in the browser.
 */

const TABLE = "platform_credentials";

const COLUMNS =
  "platform, credentials, identity, expires_at, refresh_expires_at, " +
  "updated_at, last_refresh_at, last_refresh_error";

export async function loadAll() {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS);
  if (error) throw error;

  const byPlatform = {};
  for (const row of data ?? []) byPlatform[row.platform] = row;
  return byPlatform;
}

/**
 * Writes a credential.
 *
 * `identity` is only persisted when explicitly provided, so a refresh (which
 * passes none) leaves the existing snapshot untouched instead of blanking it.
 */
export async function save(platform, record) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const row = {
    user_id: userData.user.id,
    platform,
    credentials: record.credentials ?? {},
    expires_at: record.expiresAt ?? null,
    refresh_expires_at: record.refreshExpiresAt ?? null,
  };
  if (record.identity) row.identity = record.identity;
  if (record.lastRefreshAt !== undefined)
    row.last_refresh_at = record.lastRefreshAt;
  if (record.lastRefreshError !== undefined)
    row.last_refresh_error = record.lastRefreshError;

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "user_id,platform" })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** Records why an automatic refresh failed, without touching the tokens. */
export async function recordRefreshFailure(platform, message) {
  const { error } = await supabase
    .from(TABLE)
    .update({ last_refresh_error: message })
    .eq("platform", platform);
  if (error) throw error;
}

export async function remove(platform) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("platform", platform);
  if (error) throw error;
}
