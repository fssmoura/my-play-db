/**
 * Search ranking and list helpers.
 *
 * Pure functions only: no imports, no fetching, no DOM. Everything here takes
 * data in and returns data out, so it can be reasoned about on its own and
 * reused by a different UI later.
 *
 * WHY ANY OF THIS EXISTS
 *
 * IGDB's own result order is unusable. Its relevance ranking collapses as soon
 * as the query contains punctuation - `search "marvel spider man"` puts
 * Marvel's Spider-Man first, while `search "Marvel Spider-Man"` puts a DLC
 * first - and igdb.com doesn't use that order either. Their site sorts by
 * "search query matches, popularity, and release year", so that's what we do.
 */

/** IGDB `game_type` enum. Value -> human label. */
export const GAME_TYPES = {
  0: "main game",
  1: "dlc / addon",
  2: "expansion",
  3: "bundle",
  4: "standalone expansion",
  5: "mod",
  6: "episode",
  7: "season",
  8: "remake",
  9: "remaster",
  10: "expanded game",
  11: "port",
  12: "fork",
  13: "pack",
  14: "update",
};

export function gameTypeLabel(value) {
  return GAME_TYPES[value] ?? (value == null ? "unknown" : `type ${value}`);
}

/* ---------------------------------------------------------------- naming -- */

/**
 * Lowercase, drop punctuation, collapse whitespace.
 *
 * Apostrophes are deleted rather than turned into a separator, so "Marvel's"
 * normalizes to one word ("marvels") and not two ("marvel s") - otherwise it
 * never lines up token-for-token with a typed "marvel", and every exact match
 * scored as a weak partial one.
 */
export function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * 0-300: how well one title matches what was typed.
 *
 * Token-by-token with prefix matching, so "marvel spider man" scores
 * "Marvel's Spider-Man" as an exact match and "Marvel Spider-Man Unlimited"
 * as a prefix.
 */
function titleScore(name, query) {
  const n = normalizeName(name);
  const q = normalizeName(query);
  if (!n || !q) return 0;

  const nameWords = n.split(" ");
  const queryWords = q.split(" ");

  const isPrefix = queryWords.every((token, i) =>
    (nameWords[i] ?? "").startsWith(token),
  );
  if (isPrefix) return nameWords.length === queryWords.length ? 300 : 200;

  if (n.includes(q)) return 120;

  // Last resort: every word typed appears somewhere in the title.
  const scattered = queryWords.every((token) =>
    nameWords.some((w) => w.startsWith(token)),
  );
  return scattered ? 80 : 0;
}

/**
 * Best title match, falling back to IGDB's alternative names **only when the
 * real title doesn't match at all**.
 *
 * The fallback is what makes "cod", "tw3" and "botw" work - those games are in
 * the results already, their titles just share no words with the query, while
 * "COD", "TW3" and "BotW" are all in `alternative_names`.
 *
 * It has to stay a fallback rather than a plain best-of. Alternative names
 * include edition aliases - "Elden Ring: Collector's Edition" is also known as
 * plain "Elden Ring" - so scoring them alongside real titles pushed editions
 * above the games they are editions of.
 */
export function matchScore(game, query) {
  const direct = titleScore(game?.name, query);
  if (direct > 0) return direct;

  let best = 0;
  for (const alt of game?.alternative_names ?? []) {
    if (best >= 300) break;
    best = Math.max(best, titleScore(alt?.name, query));
  }
  return best;
}

/* ------------------------------------------------------------- popularity -- */

/**
 * Values from IGDB's `popularity_primitives` are tiny normalized floats
 * (3.4e-3 for GTA V down to 1e-6 for something nobody opens), so they're
 * measured on a log scale against a floor. Below the floor they score 0, which
 * stops barely-visited entries bunching up with real games.
 */
const POPULARITY_FLOOR = 1e-5;

function popularityScore(game) {
  const visits = game?.popularity?.visits ?? 0;
  const want = game?.popularity?.want_to_play ?? 0;

  if (visits || want) {
    return (
      60 * Math.max(0, Math.log10(visits / POPULARITY_FLOOR)) +
      30 * Math.max(0, Math.log10(want / POPULARITY_FLOOR))
    );
  }

  // No popularity row (~1 game in 10) - fall back to the legacy counters.
  // Ratings only exist for released games, hype only for unreleased ones.
  const ratings = game?.total_rating_count ?? 0;
  const hype = game?.hypes ?? 0;
  return 60 * Math.log10(1 + ratings + 2 * hype);
}

/**
 * Nudge by game type: a main game should outrank the DLC, bundle and
 * "Collector's Edition" entries sharing its name, and mods and content updates
 * are almost never what you meant.
 */
const TYPE_WEIGHT = {
  0: 60, // main game
  1: 10, // dlc / addon
  2: 10, // expansion
  3: 0, // bundle
  4: 25, // standalone expansion
  5: -80, // mod
  6: 0, // episode
  7: 0, // season
  8: 25, // remake
  9: 25, // remaster
  10: 25, // expanded game
  11: 15, // port
  12: -20, // fork
  13: 0, // pack
  14: -30, // update
};

/** 0-40 nudge towards recent and upcoming releases. */
function recencyScore(game) {
  const year = releaseYear(game);
  if (!year) return 0;
  const age = new Date().getUTCFullYear() - year;
  return Math.max(0, 40 - Math.max(0, age) * 1.5);
}

export function scoreGame(game, query) {
  return (
    matchScore(game, query) +
    popularityScore(game) +
    (TYPE_WEIGHT[game?.game_type] ?? 0) +
    recencyScore(game)
  );
}

/**
 * Sorts a copy of `games` best-first. Ties fall back to IGDB's own ordering,
 * which still carries their text-relevance signal.
 */
export function rankGames(games, query) {
  return (games ?? [])
    .map((game, index) => ({ game, index, score: scoreGame(game, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.game);
}

/**
 * Re-ranks an existing list against a longer query.
 *
 * Used to show something the instant you type, without waiting for a request:
 * "marvel spide" is almost always a subset of what "marvel spid" returned.
 * Returns null when there is nothing sensible to narrow, so the caller knows
 * to wait for the real answer instead.
 */
export function narrow(games, previousQuery, query) {
  const term = String(query ?? "").trim();
  const previous = String(previousQuery ?? "").trim();
  if (!term || !previous || !games?.length) return null;
  if (term.length <= previous.length) return null;
  if (!normalizeName(term).startsWith(normalizeName(previous))) return null;

  // Filter on the title match alone. Filtering on the total score would keep a
  // game that no longer matches at all, purely because it is popular.
  const kept = games.filter((game) => matchScore(game, term) > 0);
  return kept.length ? rankGames(kept, term) : null;
}

/**
 * Combines cached games with freshly fetched ones, newest data winning.
 *
 * Used for the two-stage search: the local cache paints first, IGDB replaces
 * it a moment later. Merging by id is what keeps that from being jarring - the
 * same game arriving twice is one entry, not two, and the IGDB copy is the one
 * kept, so nothing on screen is showing older data than it has to.
 *
 * Cached games IGDB didn't return are kept rather than dropped. They matched
 * the query (the caller filters on that before getting here), so they are a
 * genuine addition rather than noise.
 *
 * Returns an unranked list - `rankGames` still has to be run over the result.
 */
export function mergeById(cached, fresh) {
  const out = [];
  const seen = new Set();

  for (const list of [fresh, cached]) {
    for (const game of list ?? []) {
      if (game?.id == null || seen.has(game.id)) continue;
      seen.add(game.id);
      out.push(game);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ lists -- */

/** Earliest release year for a game, or null. */
export function releaseYear(game) {
  if (typeof game?.first_release_date === "number") {
    return new Date(game.first_release_date * 1000).getUTCFullYear();
  }
  const dates = (game?.release_dates ?? [])
    .map((r) => r.date)
    .filter((d) => typeof d === "number");
  if (!dates.length) return null;
  return new Date(Math.min(...dates) * 1000).getUTCFullYear();
}

/** Distinct game_type values present, in enum order, with counts. */
export function typeCounts(games) {
  const counts = new Map();
  for (const game of games ?? []) {
    const type = game.game_type ?? null;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
    .map(([type, count]) => ({ type, count }));
}

/** Narrows a list to one game_type. "" or null means no filter. */
export function filterByType(games, type) {
  if (type === "" || type == null) return games ?? [];
  const wanted = Number(type);
  return (games ?? []).filter((g) => (g.game_type ?? null) === wanted);
}

/** Zero-based page of a list. */
export function pageSlice(list, page, size) {
  return (list ?? []).slice(page * size, page * size + size);
}

/** Total pages for a list, minimum 1. */
export function pageCount(list, size) {
  return Math.max(1, Math.ceil((list?.length ?? 0) / size));
}
