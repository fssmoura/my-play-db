import { getAccessToken } from "./session.js";

/**
 * Single entry point for every /api/* call.
 *
 * Papers over the one real inconsistency in the handlers: psn.js reads its
 * credentials from the TOP LEVEL of the body, every other handler expects them
 * nested inside `options`. Callers should never have to remember that.
 */
const TOP_LEVEL_CREDENTIAL_PLATFORMS = new Set(["psn"]);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function call(platform, action, options = {}, credentials = {}) {
  const token = await getAccessToken();
  if (!token) throw new ApiError("Not signed in.", 401);

  const body = { action };

  if (TOP_LEVEL_CREDENTIAL_PLATFORMS.has(platform)) {
    Object.assign(body, credentials);
    body.options = options;
  } else {
    body.options = { ...credentials, ...options };
  }

  let res;
  try {
    res = await fetch(`/api/${platform}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(
      `Network error calling /api/${platform}: ${err.message}`,
      0,
    );
  }

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      `/api/${platform} returned non-JSON (${res.status}): ${text.slice(0, 300)}`,
      res.status,
    );
  }

  if (!res.ok) {
    // Handlers return every failure as { error: "..." }. Note that a 500 here
    // usually means a bad option or an expired token, not a broken server.
    throw new ApiError(
      payload?.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }

  return payload;
}
