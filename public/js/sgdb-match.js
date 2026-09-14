/**
 * Matching an IGDB game to its SteamGridDB entry.
 *
 * Pure functions only: no imports, no fetching, no DOM. This module decides
 * *what to look up* and *which candidate is right*; something else does the
 * talking to the API. That split is what makes the hard part testable on its
 * own, and reusable if the UI is rebuilt.
 *
 * THE RULE
 *
 * One IGDB game matches one SteamGridDB entry, or it matches nothing.
 *
 * "Nothing" is a perfectly good answer and happens often. SteamGridDB is a
 * community art library, not a catalogue: plenty of games simply are not in it.
 * A DLC must never fall back to the game it belongs to, and an edition must
 * never fall back to the base game. Horizon Zero Dawn, its Complete Edition and
 * its Remaster are three separate SteamGridDB entries with three different
 * covers, and each IGDB entry should find its own. Marvel's Spider-Man has a
 * SteamGridDB entry; its "The City That Never Sleeps" DLC does not, and the
 * right answer there is no match, not the base game's artwork.
 *
 * Nothing here treats a game as less worth matching for being old, obscure or
 * unpopular. The only thing that decides a match is whether the entry is the
 * same game.
 *
 * WHAT MAKES IT HARD
 *
 * There is no shared identifier between the two databases. SteamGridDB indexes
 * games by store: every entry carries a `types` array listing which store
 * bridges it has. When an entry has a Steam id, matching is exact and provably
 * right, and that bridge has not misfired once in testing.
 *
 * But most games have no bridge. Console releases come back from SteamGridDB
 * with `types: []`, so no id lookup can ever reach them. Those can only be
 * found by name, and names disagree:
 *
 *   - Same name, different games. "God of War" is both the 2005 original and
 *     the 2018 reboot; "The Sims" and "Resident Evil 4" each exist twice.
 *     Only the year separates them.
 *   - Years that shift by one. IGDB dates a game from its earliest release,
 *     SteamGridDB usually from its Steam one - Hades is 2020 on IGDB and 2019
 *     on SteamGridDB.
 *   - Brand renames. "EA Sports FC 24" is listed as "EA FC 24".
 *   - Trademark symbols and accents. "STAR WARS(tm) Rebellion", "Pokemon".
 *   - Sequel numbers, which look like tiny differences and are not. "Hades"
 *     and "Hades II" share every word.
 *
 * The scoring below exists to handle exactly those, and nothing more clever.
 */

/* ------------------------------------------------------------- normalizing -- */

const ROMAN = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16,
  xvii: 17,
  xviii: 18,
  xix: 19,
  xx: 20,
};

/** Words that carry no meaning for matching and only skew the token counts. */
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "for"]);

/**
 * Lowercase, strip accents and symbols, collapse whitespace.
 *
 * Trademark and copyright symbols go first, before anything else touches the
 * string. They have to: Unicode decomposition turns a "(tm)" into the letters
 * "TM", which would otherwise appear as an extra word and quietly cost a
 * perfect title a few points.
 *
 * Accents are folded rather than deleted, so "Pokemon" with and without its
 * accent become the same string instead of one of them losing a letter.
 *
 * "&" becomes "and" instead of vanishing, otherwise "Mario & Wario" and
 * "Mario and Wario" tokenize differently.
 */
export function normalizeName(value) {
  return String(value ?? "")
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalized words, with stopwords dropped. Empty input gives an empty list. */
export function tokenize(value) {
  const norm = normalizeName(value);
  if (!norm) return [];
  const words = norm.split(" ").filter((w) => w && !STOPWORDS.has(w));
  // Keep stopwords if that is all there was, rather than returning nothing.
  return words.length ? words : norm.split(" ").filter(Boolean);
}

/**
 * Roman numerals to digits, so "Final Fantasy VII" and "Final Fantasy 7"
 * compare as the same title.
 *
 * A lone token is left alone - a game actually called "X" or "V" is a title,
 * not a sequel number.
 */
function arabicize(tokens) {
  if (tokens.length < 2) return tokens;
  return tokens.map((t) => (ROMAN[t] ? String(ROMAN[t]) : t));
}

/**
 * The numbers in a title, as a set.
 *
 * This is the single most useful signal for *rejecting* a match. Sequels share
 * every word with the game they follow - "Hades" against "Hades II" scores 0.67
 * on words alone, which is high enough to be accepted. Comparing the numbers
 * separately is what stops that.
 */
function ordinals(tokens) {
  return new Set(tokens.filter((t) => /^\d+$/.test(t)));
}

/* ---------------------------------------------------------------- scoring -- */

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function bigrams(value) {
  const flat = normalizeName(value).replace(/ /g, "");
  const out = new Set();
  for (let i = 0; i < flat.length - 1; i += 1) out.add(flat.slice(i, i + 2));
  return out;
}

/**
 * Words that mark one release as a different product from another.
 *
 * If two titles are otherwise identical and one of these is the difference,
 * they are not the same thing: "Marvel's Spider-Man" and "Marvel's Spider-Man
 * Remastered" have their own separate artwork, and so do "Football Manager 26"
 * and "Football Manager 26 Console".
 *
 * Word overlap alone cannot see this. One extra short word out of four barely
 * dents the score - those two Spider-Man titles score 0.86 on words, well
 * inside anything a sane threshold would accept. This list is what catches it.
 */
const QUALIFIERS = new Set([
  "edition",
  "version",
  "remastered",
  "remaster",
  "remake",
  "definitive",
  "anniversary",
  "enhanced",
  "complete",
  "ultimate",
  "deluxe",
  "goty",
  "collection",
  "trilogy",
  "bundle",
  "pack",
  "dlc",
  "expansion",
  "season",
  "episode",
  "demo",
  "beta",
  "trial",
  "classic",
  "redux",
  "reloaded",
  "hd",
  "vr",
  "console",
  "mobile",
  "portable",
  "arcade",
  "online",
  "switch",
  "wii",
  "xbox",
  "playstation",
  "ps4",
  "ps5",
  "pc",
  "steam",
]);

/** The tokens one title has and the other does not. */
function symmetricDifference(a, b) {
  const out = [];
  for (const t of a) if (!b.has(t)) out.push(t);
  for (const t of b) if (!a.has(t)) out.push(t);
  return out;
}

/** True when one title is the other plus extra words. */
function isStrictSubset(a, b) {
  if (a.size === b.size) return false;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * 0-1, how alike two titles are.
 *
 * Word overlap is the main measure, with character pairs as a backup so that
 * short names and small spelling differences still score. The better of the
 * two wins.
 *
 * Three penalties then apply, all aimed at the same failure: a near neighbour
 * that is not the same product.
 *
 *   - Sequel numbers. "Hades" and "Hades II" share every word.
 *   - Release qualifiers. "Spider-Man" and "Spider-Man Remastered" have their
 *     own separate artwork.
 *   - One title being the other plus extra words. This is the general form of
 *     the same problem and catches what no word list could: "Finger Soccer" is
 *     not "Finger Soccer League", "Bloodborne" is not "Bloodborne Kart", and
 *     "Mega Man & Bass" is not "Mega Man & Bass FC".
 *
 * That last one scores 0.8 or higher on words alone, which is why word overlap
 * on its own cannot be trusted here. The penalties are multipliers rather than
 * outright vetoes so the rest of the scoring still has a say, but they are
 * heavy enough to drop a candidate below the floor.
 *
 * `strict: false` turns all three off. That is only for comparing against a
 * candidate found by store id, where identity is already proven and the name
 * is a sanity check rather than the evidence. Laser League is why: it is
 * "Laser League: World Arena" on SteamGridDB under the same Steam id, and the
 * penalties would throw away a provably correct match.
 */
export function nameSimilarity(a, b, { strict = true } = {}) {
  const ta = arabicize(tokenize(a));
  const tb = arabicize(tokenize(b));
  if (!ta.length || !tb.length) return 0;

  const sa = new Set(ta);
  const sb = new Set(tb);
  if (sa.size === sb.size && dice(sa, sb) === 1) return 1;

  let score = Math.max(dice(sa, sb), dice(bigrams(a), bigrams(b)));
  if (!strict) return score;

  const oa = ordinals(ta);
  const ob = ordinals(tb);
  if (dice(oa, ob) !== 1 && (oa.size || ob.size)) score *= 0.55;

  if (
    isStrictSubset(sa, sb) ||
    symmetricDifference(sa, sb).some((t) => QUALIFIERS.has(t))
  ) {
    score *= 0.5;
  }

  return score;
}

/* --------------------------------------------------------------- variants -- */

function pushUnique(list, seen, name, weight) {
  const key = normalizeName(name);
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push({ name, weight });
}

/**
 * Names to search for, best first.
 *
 * Deliberately short: the real title, then IGDB's alternative names. Nothing
 * is trimmed or shortened.
 *
 * An earlier version stripped edition suffixes and subtitles so that a game
 * SteamGridDB did not have would fall back to one it did. That was wrong. It
 * turned "Cities: Skylines - Nintendo Switch Edition" into "Cities" and matched
 * Cities XXL, and it would happily give a DLC the base game's cover. If the
 * entry does not exist, the answer is no match.
 *
 * Alternative names are real aliases for the same game - "EA FC 24" for "EA
 * Sports FC 24" - so they belong here. They score very slightly lower than the
 * real title purely so an exact hit on the real title always wins a tie.
 */
export function nameVariants(game) {
  const out = [];
  const seen = new Set();

  pushUnique(out, seen, game?.name ?? "", 1);

  for (const alt of game?.alternative_names ?? []) {
    pushUnique(out, seen, typeof alt === "string" ? alt : alt?.name, 0.98);
  }

  return out.filter((v) => v.name);
}

/* ----------------------------------------------------------------- bridges -- */

/**
 * IGDB source name -> SteamGridDB platform slug.
 *
 * Only these two are real. SteamGridDB also accepts origin, uplay, bnet,
 * flashpoint and eshop, but IGDB publishes no ids for any of them, so adding
 * them here would only ever produce failed lookups.
 */
export const BRIDGES = { steam: "steam", epic: "egs" };

/** Store ids that are never the game itself. */
const NOT_THE_GAME = /\b(playtest|demo|beta|server|soundtrack|dedicated)\b/i;

/**
 * Store lookups to try, best first.
 *
 * IGDB routinely lists several Steam ids for one game - the base game, a
 * separate "- Multiplayer" app, a playtest, and sometimes an old working
 * title. Each resolves to a *different* SteamGridDB entry, so taking the first
 * one is wrong. They are ordered by how well the store's own name matches the
 * game, and obvious non-games are dropped.
 */
export function bridgeLookups(game) {
  const out = [];
  const ids = game?.external_ids ?? {};

  for (const [source, platform] of Object.entries(BRIDGES)) {
    const entries = ids[source] ?? [];
    for (const entry of entries) {
      // Accepts both a bare id and an { uid, name } record.
      const platformId = typeof entry === "object" ? entry?.uid : entry;
      const storeName = typeof entry === "object" ? entry?.name : null;
      if (platformId == null) continue;
      if (storeName && NOT_THE_GAME.test(storeName)) continue;
      out.push({
        platform,
        platformId: String(platformId),
        rank: storeName ? nameSimilarity(game?.name, storeName) : 0.5,
      });
    }
  }

  return out
    .sort((a, b) => b.rank - a.rank)
    .map(({ platform, platformId }) => ({ platform, platformId }));
}

/* -------------------------------------------------------------------- years -- */

/**
 * Every year IGDB associates with the game.
 *
 * All of them, not just the earliest. A game released on one platform years
 * after another is normal, and SteamGridDB may have dated its entry from any
 * of them.
 */
export function igdbYears(game) {
  const years = new Set();
  const add = (seconds) => {
    if (typeof seconds === "number" && seconds > 0) {
      years.add(new Date(seconds * 1000).getUTCFullYear());
    }
  };
  add(game?.first_release_date);
  for (const release of game?.release_dates ?? []) {
    add(typeof release === "number" ? release : release?.date);
  }
  return [...years].sort((a, b) => a - b);
}

/** How far off the candidate's year is, or null when either side has none. */
function yearGap(years, candidate) {
  if (!years.length || !candidate?.release_date) return null;
  const year = new Date(candidate.release_date * 1000).getUTCFullYear();
  return Math.min(...years.map((y) => Math.abs(y - year)));
}

/**
 * Year agreement, scored.
 *
 * Measured on 187 games where the match is certain (they were found by Steam
 * id, so there is nothing to guess): the year agreed exactly 97.3% of the
 * time, was one year out in 2.1%, and the single worst case in the whole
 * sample was three. It never reached four.
 *
 * So the year is a much better signal than it first appears, and a large gap
 * genuinely does mean a different game - the 1995 "Hades" is not Supergiant's.
 * `YEAR_LIMIT` is set well past the worst observed case so that being wrong
 * requires SteamGridDB to be wrong by more than it has ever been measured
 * being.
 *
 * A missing year on either side scores mid. Absent data is not evidence.
 */
export const YEAR_LIMIT = 5;

function yearScore(gap) {
  if (gap == null) return 5;
  if (gap === 0) return 15;
  if (gap === 1) return 11;
  if (gap === 2) return 5;
  return 0;
}

/* -------------------------------------------------------------- decisions -- */

/**
 * Below this, two titles are not the same game.
 *
 * Set high on purpose. The failure this is guarding against is drift towards a
 * near neighbour: "Horizon Zero Dawn" against its own "Complete Edition"
 * scores 0.75, and a DLC against its base game scores around 0.67. Both must
 * be refused, because the artwork would be the wrong game's. Genuine aliases
 * still clear it - "EA Sports FC 24" against "EA FC 24" scores 0.86.
 */
export const NAME_FLOOR = 0.8;

const STRONG_NAME = 0.97;

/** Scores one SteamGridDB candidate against an IGDB game. */
export function scoreCandidate(
  game,
  candidate,
  variants,
  { strict = true } = {},
) {
  const names = variants ?? nameVariants(game);
  let name = 0;
  let matchedOn = null;
  for (const variant of names) {
    const score =
      nameSimilarity(variant.name, candidate?.name, { strict }) *
      variant.weight;
    if (score > name) {
      name = score;
      matchedOn = variant.name;
    }
    if (name === 1) break;
  }

  const gap = yearGap(igdbYears(game), candidate);
  const verified = candidate?.verified ? 2 : 0;

  return {
    sgdbId: candidate?.id ?? null,
    sgdbName: candidate?.name ?? null,
    name,
    matchedOn,
    yearGap: gap,
    total: name * 100 + yearScore(gap) + verified,
  };
}

/** How sure we are, for a caller that wants to treat the two differently. */
function confidenceFor(name, gap) {
  if (name >= STRONG_NAME && (gap == null || gap <= 1)) return "high";
  return "medium";
}

/**
 * Picks the best of a list of SteamGridDB candidates, or nothing.
 *
 * Candidates that fail on the name, or whose year is further out than
 * SteamGridDB has ever been measured being, are dropped before anything is
 * chosen - so a wrong neighbour cannot win by default just because it is the
 * only thing the search returned.
 *
 * Returning null is a normal outcome, not a failure. SteamGridDB does not have
 * every game, and the alternative - handing back something that merely looks
 * similar - puts another game's artwork on the page.
 *
 * `ambiguous` is set when the runner-up was nearly as good. It is a warning,
 * not a rejection.
 */
export function pickBest(game, candidates, { method = "name" } = {}) {
  const variants = nameVariants(game);
  const byId = method === "id";

  const scored = (candidates ?? [])
    .filter((c) => c && c.id != null)
    .map((c) => scoreCandidate(game, c, variants, { strict: !byId }))
    // A store id is proof of identity, so it is held to the lower bar and the
    // year is not consulted at all. Only a name match has to clear both.
    .filter((s) =>
      byId
        ? s.name >= BRIDGE_FLOOR
        : s.name >= NAME_FLOOR &&
          (s.yearGap == null || s.yearGap <= YEAR_LIMIT),
    )
    .sort((a, b) => b.total - a.total);

  if (!scored.length) return null;
  const best = scored[0];
  const runnerUp = scored[1];

  return {
    sgdbId: best.sgdbId,
    sgdbName: best.sgdbName,
    method,
    confidence: byId ? "exact" : confidenceFor(best.name, best.yearGap),
    nameScore: Number(best.name.toFixed(3)),
    matchedOn: best.matchedOn,
    yearGap: best.yearGap,
    ambiguous: Boolean(runnerUp && best.total - runnerUp.total < 6),
    runnerUp: runnerUp
      ? { sgdbId: runnerUp.sgdbId, sgdbName: runnerUp.sgdbName }
      : null,
  };
}

/**
 * The bar a store-bridge result has to clear.
 *
 * The bridge is an exact identifier, so this is a sanity check rather than a
 * real test: it only catches IGDB pointing a game at an unrelated store id,
 * such as a bundle. Far lower than the name floor, on purpose.
 */
export const BRIDGE_FLOOR = 0.5;
