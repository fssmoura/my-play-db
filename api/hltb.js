/**
 * HowLongToBeat.
 *
 * THERE IS NO API HERE. THIS IS A PORT OF A SCRAPER.
 *
 * HowLongToBeat has no public API and is not going to get one - it has been an
 * IGN Entertainment brand since 2019, and IGN's terms forbid exactly this. What
 * the site actually has is an internal endpoint its own front end calls, and
 * that is what this file talks to.
 *
 * The logic is ported from the HLTB for Deck plugin (MIT,
 * github.com/morwy/hltb-for-deck, src/hooks/HltbApi.ts), which is the only
 * implementation still being maintained against HLTB's current defences. The
 * shape below is deliberately close to that file so the next time HLTB changes
 * something, their fix can be read across directly.
 *
 * HOW THE ENDPOINT DEFENDS ITSELF
 *
 * Three moving parts, all of which rotate:
 *
 *   1. The path. It has been /api/search, then /api/find, /api/seek,
 *      /api/bleed, and is /api/search/site today. So it is DISCOVERED on every
 *      cold start by reading HLTB's own homepage and finding the POST its
 *      JavaScript makes. NEVER HARDCODE IT. Every dead HLTB client on npm and
 *      GitHub died exactly this way, and the abandoned original of the Decky
 *      plugin returns 403 right now for this reason.
 *   2. A token, from `<path>/init`, returned alongside a key/value pair whose
 *      key NAME is itself part of the puzzle - it has to be echoed back both as
 *      a header and as a dynamically-named field inside the request body.
 *      Missing that body field is a 403.
 *   3. A Next.js build id, needed for the per-game page that carries the Steam
 *      id and the fuller playtime breakdown.
 *
 * The token is bound to the IP and User-Agent that requested it, which is why
 * USER_AGENT is a fixed string rather than anything randomised: the value used
 * to mint a token must be the value used to spend it.
 *
 * WHEN IT BREAKS
 *
 * It will, roughly twice a year. Every failure path below responds the same
 * way - throw away what we think we know, re-discover, try again - and the
 * `auth` action exists so the console can show what was discovered without
 * having to read logs.
 *
 * Times are returned in SECONDS, exactly as HLTB sends them. Converting to
 * hours is presentation, and belongs nowhere near here.
 */

const { setCorsHeaders, handlePreflight } = require("./_cors");
const { requireUser } = require("./_auth");

const BASE = "https://howlongtobeat.com";

/**
 * One fixed browser identity.
 *
 * Not randomised on purpose: HLTB's token encodes the User-Agent that asked
 * for it, so rotating this between the init call and the search call invalidates
 * the token. Kept in step with the Decky plugin, which tracks the Python
 * library's findings (ScrappyCocco/HowLongToBeat-PythonAPI#53).
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36";

/** Last known good path, used only when discovery fails outright. */
const DEFAULT_SEARCH_PATH = "/api/search/site";

/**
 * How long a discovered path, token or build id is reused.
 *
 * Short, because all three rotate and the retry ladder can recover anyway.
 * This exists to stop a burst of lookups re-scraping the homepage each time,
 * not to hold anything for long.
 */
const AUTH_TTL_MS = 5 * 60 * 1000;
const DISCOVERY_TTL_MS = 30 * 60 * 1000;

/* --------------------------------------------------------- warm-state cache -- */

// Survives between invocations while a serverless instance stays warm, and is
// rebuilt from scratch when it does not. Nothing here is required to be present.
let searchPath = null;
let searchPathAt = 0;
let auth = null;
let authAt = 0;
let buildId = null;
let buildIdAt = 0;

function fresh(at, ttl) {
  return Date.now() - at < ttl;
}

function forgetAuth() {
  auth = null;
  authAt = 0;
}

function forgetDiscovery() {
  searchPath = null;
  searchPathAt = 0;
  buildId = null;
  buildIdAt = 0;
  forgetAuth();
}

/* ----------------------------------------------------------------- fetching -- */

function baseHeaders() {
  return {
    "Content-Type": "application/json",
    Origin: BASE,
    Referer: `${BASE}/`,
    "User-Agent": USER_AGENT,
  };
}

function searchHeaders(current) {
  return {
    ...baseHeaders(),
    Authority: "howlongtobeat.com",
    "x-auth-token": current.token,
    "x-hp-key": current.hpKey,
    "x-hp-val": current.hpVal,
  };
}

async function getText(url) {
  const res = await fetch(url, { headers: baseHeaders() });
  if (!res.ok) throw new Error(`HLTB error: ${res.status} fetching ${url}`);
  return res.text();
}

/* ---------------------------------------------------------------- discovery -- */

/** Every `<script src>` on a page, resolved to absolute URLs. */
function scriptUrls(html, base) {
  const out = [];
  const pattern = /<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    if (!match[2]) continue;
    try {
      out.push(new URL(match[2], `${base}/`).toString());
    } catch {
      // A malformed src is not worth failing discovery over.
    }
  }
  return out;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The search path, read out of one of HLTB's own script bundles.
 *
 * Only bundles mentioning both `searchTerms` and `searchOptions` are considered,
 * which is what stops an unrelated POST elsewhere in the site being mistaken for
 * the search call.
 *
 * The whole path is kept, including slashes. Truncating at the first slash is
 * precisely the bug that broke the Decky plugin in September 2026 when HLTB
 * moved from the single-segment /api/bleed to the nested /api/search/site
 * (hltb-for-deck#62).
 *
 * A candidate whose matching `/init` route also appears in the same bundle wins
 * outright, because that pairing is what the auth step needs.
 */
function searchPathFromScript(text) {
  if (!text.includes("searchTerms") || !text.includes("searchOptions")) {
    return null;
  }

  const pattern =
    /fetch\s*\(\s*["'`]\/api\/([a-zA-Z0-9_/]+)[^"'`]*["'`]\s*,\s*{[^}]*method:\s*["'`]POST["'`][^}]*}/gi;
  const candidates = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (!match[1]) continue;
    const path = match[1].replace(/\/+$/, "").replace(/\/init$/i, "");
    if (!path) continue;

    const discovered = `/api/${path}`;
    const initPattern = new RegExp(`\\/api\\/${escapeRegex(path)}\\/init`, "i");
    if (initPattern.test(text)) return discovered;

    candidates.push(discovered);
  }

  return candidates[0] ?? null;
}

/**
 * Walks HLTB's homepage scripts looking for the search path and the Next.js
 * build id in one pass, since both live in the same HTML.
 *
 * Returns the last known good path rather than throwing when the search path
 * cannot be found: HLTB may simply have restructured its bundles, and the
 * fallback has a real chance of still working.
 */
async function discover() {
  const html = await getText(BASE);
  const scripts = scriptUrls(html, BASE);

  let foundBuildId = null;
  let foundPath = null;

  for (const src of scripts) {
    let url;
    try {
      url = new URL(src);
    } catch {
      continue;
    }

    const manifest = url.pathname.match(
      /\/_next\/static\/(.+)\/(?:_ssgManifest|_buildManifest)\.js/,
    );
    if (manifest && manifest[1] && !foundBuildId) {
      foundBuildId = manifest[1];
      continue;
    }

    if (foundPath) continue;
    if (url.origin !== BASE || !url.pathname.endsWith(".js")) continue;

    let text;
    try {
      text = await getText(url.toString());
    } catch {
      continue;
    }

    foundPath = searchPathFromScript(text);
  }

  const now = Date.now();
  searchPath = foundPath ?? DEFAULT_SEARCH_PATH;
  searchPathAt = now;
  if (foundBuildId) {
    buildId = foundBuildId;
    buildIdAt = now;
  }

  return { searchPath, buildId, discovered: Boolean(foundPath) };
}

async function getSearchPath({ force = false } = {}) {
  if (!force && searchPath && fresh(searchPathAt, DISCOVERY_TTL_MS)) {
    return searchPath;
  }
  await discover();
  return searchPath;
}

async function getBuildId({ force = false } = {}) {
  if (!force && buildId && fresh(buildIdAt, DISCOVERY_TTL_MS)) return buildId;
  await discover();
  if (!buildId)
    throw new Error("HLTB error: could not find the Next.js build id");
  return buildId;
}

/* --------------------------------------------------------------------- auth -- */

/**
 * Pulls the token tuple out of `/init`.
 *
 * The key and value field NAMES are not stable - only `token` is. So anything
 * whose name contains "key" or "val" is taken, which is how the Decky plugin
 * survives HLTB renaming them (they are `hpKey`/`hpVal` today).
 */
function parseAuth(data) {
  if (!data || typeof data !== "object") return null;

  const token = typeof data.token === "string" ? data.token : null;
  let hpKey = null;
  let hpVal = null;

  for (const [name, value] of Object.entries(data)) {
    if (typeof value !== "string") continue;
    const lower = name.toLowerCase();
    if (!hpKey && lower.includes("key")) hpKey = value;
    else if (!hpVal && lower.includes("val")) hpVal = value;
  }

  if (!token || !hpKey || !hpVal) return null;
  return { token, hpKey, hpVal };
}

async function fetchAuth(path) {
  const res = await fetch(`${BASE}${path}/init?t=${Date.now()}`, {
    method: "GET",
    headers: baseHeaders(),
  });
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const parsed = parseAuth(data);
  if (parsed) {
    auth = parsed;
    authAt = Date.now();
  }
  return parsed;
}

/**
 * A usable token, re-discovering the path if the current one cannot mint one.
 *
 * `rediscover` forces the path to be looked up again first - the heavier of the
 * two recoveries, used only once the lighter one has already failed.
 */
async function refreshAuth({ rediscover = false } = {}) {
  const path = await getSearchPath({ force: rediscover });
  forgetAuth();

  const first = await fetchAuth(path);
  if (first || rediscover) return first;

  // The path we had is probably stale. Re-read it and try once more.
  const rediscovered = await getSearchPath({ force: true });
  return fetchAuth(rediscovered);
}

/**
 * Runs a request that needs the token, refreshing on any non-200.
 *
 * Three rungs, cheapest first: use what we have, mint a new token, then throw
 * away the discovered path as well and start over. HLTB answers an expired
 * token with a 403 rather than anything descriptive, so retrying is the only
 * way to tell "expired" from "genuinely broken".
 */
async function withAuth(run) {
  let current = auth && fresh(authAt, AUTH_TTL_MS) ? auth : await refreshAuth();
  if (!current) throw new Error("HLTB error: could not obtain a search token");

  let res = await run(current, searchPath);
  if (res.ok) return res;

  current = await refreshAuth();
  if (current) {
    res = await run(current, searchPath);
    if (res.ok) return res;
  }

  current = await refreshAuth({ rediscover: true });
  if (!current) throw new Error("HLTB error: could not obtain a search token");

  res = await run(current, searchPath);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HLTB error: ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

/* ------------------------------------------------------------------ trimming -- */

/**
 * The playtime fields, in seconds, exactly as HLTB names them.
 *
 * The `_count` values matter as much as the times: they are the number of
 * submissions behind each figure, and a number backed by three people is not
 * the same claim as one backed by three thousand.
 */
const TIME_FIELDS = (g) => ({
  comp_main: g.comp_main ?? null,
  comp_plus: g.comp_plus ?? null,
  comp_100: g.comp_100 ?? null,
  comp_all: g.comp_all ?? null,
  comp_main_count: g.comp_main_count ?? null,
  comp_plus_count: g.comp_plus_count ?? null,
  comp_100_count: g.comp_100_count ?? null,
  comp_all_count: g.comp_all_count ?? null,
});

const SEARCH_FIELDS = (g) => {
  if (!g || g.game_id == null) return null;
  return {
    game_id: g.game_id,
    game_name: g.game_name ?? null,
    game_alias: g.game_alias || null,
    game_type: g.game_type ?? null,
    release_world: g.release_world ?? null,
    profile_platform: g.profile_platform ?? null,
    profile_steam: g.profile_steam || null,
    ...TIME_FIELDS(g),
  };
};

const GAME_FIELDS = (g) => {
  if (!g || g.game_id == null) return null;
  return {
    game_id: g.game_id,
    game_name: g.game_name ?? null,
    game_alias: g.game_alias || null,
    game_type: g.game_type ?? null,
    release_world: g.release_world ?? null,
    profile_platform: g.profile_platform ?? null,
    profile_dev: g.profile_dev ?? null,
    // The Steam appid. The single most valuable field here: it turns a guess
    // about which entry this is into a fact.
    profile_steam: g.profile_steam || null,
    ...TIME_FIELDS(g),
  };
};

/* ------------------------------------------------------------------ actions -- */

/**
 * A game name split into the terms HLTB expects.
 *
 * MEASURED: punctuation left attached to a term makes the search return
 * NOTHING, silently. "Horizon Zero Dawn: Complete Edition" finds 0 results;
 * drop the colon and it finds the entry immediately. A curly apostrophe is
 * worse - "Marvel's Spider-Man" with the typographic form finds 0, the same
 * name stripped finds 9. This presents as "HLTB doesn't have that game", which
 * is indistinguishable from the truth and is why it is handled here rather than
 * left to callers.
 *
 * Apostrophes are deleted and everything else non-alphanumeric becomes a space,
 * which is the same rule `normalizeName()` uses in `public/js/sgdb-match.js`.
 * Tested across seven awkward titles: never worse than sending the raw name,
 * sometimes the difference between 0 results and the right one.
 */
function searchTerms(name) {
  return String(name)
    .replace(/['\u2019]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * The search body HLTB expects.
 *
 * `modifier` is left empty rather than set to `hide_dlc` as the Decky plugin
 * does. The plugin is matching a game someone is playing on a Steam Deck, so
 * hiding DLC is a safe simplification; here the library contains DLC and
 * expansions as entries in their own right, and each needs to find its own
 * HLTB record rather than being quietly unmatchable.
 */
function searchBody(name, { page = 1, size = 20 } = {}, current) {
  return {
    searchType: "games",
    searchTerms: searchTerms(name),
    searchPage: page,
    size,
    searchOptions: {
      games: {
        userId: 0,
        platform: "",
        sortCategory: "name",
        rangeCategory: "main",
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
        modifier: "",
      },
      users: {},
      filter: "",
      sort: 0,
      randomizer: 0,
    },
    // The token's value repeated inside the body, under a field named by
    // `hpKey` itself - so the field is literally called something like
    // "ign_5adbe3f6", not "hpKey". This is the least obvious part of the whole
    // exchange and the easiest to get subtly wrong.
    //
    // MEASURED: getting the field NAME wrong returns 404, not 403. A 404 here
    // therefore means "the body was malformed", not "the route moved" - so do
    // not react to one by re-running path discovery.
    [current.hpKey]: current.hpVal,
  };
}

const actions = {
  /**
   * What the handler currently believes about HLTB's defences.
   *
   * Purely diagnostic, and the first thing to run from the console when this
   * stops working: it says whether the path was really discovered or fell back,
   * and whether a token can still be minted at all.
   */
  async auth() {
    const { searchPath: path, discovered } = await discover();
    const current = await refreshAuth();
    return {
      searchPath: path,
      discovered,
      buildId,
      token: current?.token ?? null,
      hpKey: current?.hpKey ?? null,
      hpVal: current?.hpVal ?? null,
    };
  },

  async search(options = {}) {
    const { name, page, size } = options;
    if (!name) throw new Error("name is required");

    const res = await withAuth((current, path) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: searchHeaders(current),
        body: JSON.stringify(searchBody(name, { page, size }, current)),
      }),
    );

    const data = await res.json();
    if (!Array.isArray(data?.data)) {
      throw new Error("HLTB error: search returned an unexpected shape");
    }
    return data.data.map(SEARCH_FIELDS).filter(Boolean);
  },

  /**
   * One game's record, from the page data behind its detail page.
   *
   * A separate mechanism from search - a build id rather than a token - so it
   * fails separately too. Worth the extra request because this is where
   * `profile_steam` lives, and an exact Steam id is the difference between
   * knowing and guessing which entry belongs to a game.
   */
  async game(options = {}) {
    const { hltbId } = options;
    if (hltbId == null) throw new Error("hltbId is required");
    const id = Number(hltbId);
    if (!Number.isFinite(id)) throw new Error("hltbId must be a number");

    const load = async (key) =>
      fetch(`${BASE}/_next/data/${key}/game/${id}.json`, {
        method: "GET",
        headers: baseHeaders(),
      });

    let res = await load(await getBuildId());
    if (!res.ok) {
      // A rotated build id is the usual cause, and looks like a 404.
      res = await load(await getBuildId({ force: true }));
    }
    if (!res.ok) {
      if (res.status === 404) return null;
      const text = await res.text().catch(() => "");
      throw new Error(`HLTB error: ${res.status} ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const list = data?.pageProps?.game?.data?.game;
    if (!Array.isArray(list) || list.length !== 1) return null;
    return GAME_FIELDS(list[0]);
  },

  /** Drops everything discovered, so the next call starts from the homepage. */
  async reset() {
    forgetDiscovery();
    return { reset: true };
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const raw = req.method === "GET" ? req.query : (req.body ?? {});
  const body = {};
  for (const key of Object.keys(raw)) {
    try {
      body[key] = JSON.parse(raw[key]);
    } catch {
      body[key] = raw[key];
    }
  }
  const { action, options } = body;

  if (!action) return res.status(400).json({ error: "action is required" });

  if (!actions[action])
    return res.status(400).json({ error: `Unknown action: ${action}` });

  try {
    const data = await actions[action](options ?? {});
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
