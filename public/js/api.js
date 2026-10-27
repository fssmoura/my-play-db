// Adapted from public/lab/js/api.js (the part the new app needs). The two
// copies are now independent.
import { getAccessToken } from "/js/session.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** POSTs one action to /api/<platform> with the signed-in user's token. */
export async function call(platform, action, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new ApiError("Not signed in.", 401);

  let res;
  try {
    res = await fetch(`/api/${platform}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, options }),
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
    throw new ApiError(
      payload?.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return payload;
}
