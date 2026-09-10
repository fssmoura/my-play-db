const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

// token -> { user, expiresAtMs }
const tokenCache = new Map();

function getCachedUser(token) {
  const entry = tokenCache.get(token);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    tokenCache.delete(token);
    return null;
  }
  return entry.user;
}

function setCachedUser(token, user) {
  if (tokenCache.size > CACHE_MAX_ENTRIES) tokenCache.clear();
  tokenCache.set(token, { user, expiresAtMs: Date.now() + CACHE_TTL_MS });
}

function extractToken(req) {
  const headers = req.headers ?? {};
  const authHeader = headers.authorization ?? headers.Authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const token = match[1].trim();
      if (token) return token;
    }
  }

  const query = req.query;
  if (query && typeof query === "object") {
    const fromQuery = query.access_token;
    if (typeof fromQuery === "string" && fromQuery.trim()) {
      return fromQuery.trim();
    }
  }

  // Only read an already-parsed body object. Never consume the raw stream here.
  const body = req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    const fromBody = body.access_token;
    if (typeof fromBody === "string" && fromBody.trim()) {
      return fromBody.trim();
    }
  }

  return null;
}

async function requireUser(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "auth is not configured on the server" });
    return null;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "authentication required" });
    return null;
  }

  const ownerUserId = process.env.OWNER_USER_ID;

  const cached = getCachedUser(token);
  if (cached) {
    if (ownerUserId && cached.id !== ownerUserId) {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    return cached;
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    res.status(401).json({ error: "session verification failed" });
    return null;
  }

  if (!response.ok) {
    res.status(401).json({ error: "invalid or expired session" });
    return null;
  }

  let user;
  try {
    user = await response.json();
  } catch {
    res.status(401).json({ error: "session verification failed" });
    return null;
  }

  if (!user || !user.id) {
    res.status(401).json({ error: "invalid or expired session" });
    return null;
  }

  setCachedUser(token, user);

  if (ownerUserId && user.id !== ownerUserId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }

  return user;
}

module.exports = { requireUser };
