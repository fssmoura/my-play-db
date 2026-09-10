import { supabase } from "./supabase.js";

/**
 * Cross-device store for platform tokens.
 *
 * Row shape (public.platform_credentials):
 *   platform, credentials{}, identity{}, expires_at, refresh_expires_at
 *
 * RLS scopes every row to auth.uid(), so there is no way to read another
 * account's tokens even though this runs in the browser.
 */

const TABLE = "platform_credentials";

export async function loadAll() {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "platform, credentials, identity, expires_at, refresh_expires_at, updated_at",
    );
  if (error) throw error;

  const byPlatform = {};
  for (const row of data ?? []) byPlatform[row.platform] = row;
  return byPlatform;
}

export async function save(platform, record) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const row = {
    user_id: userData.user.id,
    platform,
    credentials: record.credentials ?? {},
    identity: record.identity ?? {},
    expires_at: record.expiresAt ?? null,
    refresh_expires_at: record.refreshExpiresAt ?? null,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "user_id,platform" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function remove(platform) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("platform", platform);
  if (error) throw error;
}
