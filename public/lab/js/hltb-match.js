/**
 * Matching an IGDB game to its HowLongToBeat entry.
 *
 * Pure functions only: no imports beyond the shared scoring, no fetching, no
 * DOM. This module decides *which candidate is right*; `hltb.js` does the
 * talking to the API.
 *
 * WHY THIS REUSES THE STEAMGRIDDB SCORING
 *
 * `nameSimilarity` and friends in `sgdb-match.js` solve a problem that is not
 * SteamGridDB-specific: two databases naming the same game differently, with
 * sequels, editions and remasters sitting next to each other looking almost
 * identical. That is exactly the problem here, and the penalties it encodes -
 * sequel numbers, release qualifiers, one title being another plus extra words
 * - were tuned against real failures. Duplicating them would mean two copies
 * drifting apart, so they are imported instead.
 *
 * WHERE THIS DELIBERATELY DIFFERS FROM THE DECKY PLUGIN
 *
 * The HLTB for Deck plugin, which this integration's API client is ported
 * from, ALWAYS returns something: when nothing matches it falls back to the
 * smallest edit distance it can find. On a Steam Deck that is reasonable - the
 * user is looking at a game they demonstrably own, so the nearest name is
 * probably it.
 *
 * Here it would be wrong. This library holds DLC, expansions and special
 * editions as entries in their own right, sitting directly beside their base
 * games. "Nearest name" is precisely how a DLC inherits its base game's 60-hour
 * completion time and quietly tells you something false. So:
 *
 *   NO MATCH IS A VALID ANSWER, and a common one.
 *
 * A blank playtime is honest. A wrong one is not, and is worse than nothing
 * because there is no way to tell it apart from a right one.
 *
 * THE EVIDENCE, IN ORDER
 *
 *   1. Steam id. HLTB publishes `profile_steam` on a game's detail page, and
 *      IGDB publishes Steam ids too. When they agree, identity is proven and
 *      the name is only a sanity check. This is the only signal here that is
 *      not a guess.
 *   2. Name and year, scored. Everything else.
 */

import {
  igdbYears,
  nameSimilarity,
  nameVariants,
  normalizeName,
  BRIDGE_FLOOR,
  NAME_FLOOR,
  YEAR_LIMIT,
} from "./sgdb-match.js";

export { NAME_FLOOR, YEAR_LIMIT, BRIDGE_FLOOR };

/* ------------------------------------------------------------ candidate shape -- */

/**
 * The names one HLTB entry is known by.
 *
 * `game_alias` is a real second title rather than a near-spelling - Elden Ring
 * carries "Elden Ring Tarnished Edition" - so it is worth matching against, but
 * it is scored slightly lower so a hit on the primary name always wins a tie.
 */
export function candidateNames(candidate) {
  const out = [];
  if (candidate?.game_name) out.push({ name: candidate.game_name, weight: 1 });
  for (const alias of String(candidate?.game_alias ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    out.push({ name: alias, weight: 0.98 });
  }
  return out;
}

/**
 * The candidate's release year.
 *
 * HLTB reports `release_world` two different ways depending on where the record
 * came from: search returns a bare year (`2022`), the detail page returns a full
 * date (`"2022-02-25"`). Both are handled here rather than at the call sites,
 * because a caller mixing the two is otherwise an invisible bug.
 */
export function candidateYear(candidate) {
  const raw = candidate?.release_world;
  if (raw == null) return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  const match = String(raw).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

/* ----------------------------------------------------------------- categories -- */

/**
 * IGDB game types that mean "an add-on to something else".
 *
 * 1 dlc_addon, 2 expansion, 4 standalone_expansion, 6 episode, 7 season.
 * Standalone expansions are included on purpose: HLTB lists them as their own
 * entries with their own times, which is the behaviour we want to preserve.
 */
const IGDB_ADDON_TYPES = new Set([1, 2, 4, 6, 7]);

/** HLTB's own word for the same idea. */
const HLTB_ADDON_TYPES = new Set(["dlc"]);

/**
 * True when both sides state a category and they disagree about add-on-ness.
 *
 * This is the one signal the name scoring cannot provide. "Elden Ring" and
 * "Elden Ring: Shadow of the Erdtree" are caught by the subset penalty, but
 * plenty of DLC is named nothing like its parent, and plenty of parents share
 * a name with their DLC in ways that score well. Returning null rather than
 * false when either side is silent matters: absent data is not evidence.
 */
export function categoryConflict(game, candidate) {
  const igdbType = game?.game_type;
  const hltbType = candidate?.game_type;
  if (igdbType == null || !hltbType) return null;
  const igdbAddon = IGDB_ADDON_TYPES.has(Number(igdbType));
  const hltbAddon = HLTB_ADDON_TYPES.has(String(hltbType).toLowerCase());
  return igdbAddon !== hltbAddon;
}

/* --------------------------------------------------------------------- steam -- */

/** Every Steam appid IGDB lists for this game, as numbers. */
export function steamIds(game) {
  const out = new Set();
  for (const entry of game?.external_ids?.steam ?? []) {
    const uid = typeof entry === "object" ? entry?.uid : entry;
    const id = Number(uid);
    if (Number.isFinite(id) && id > 0) out.add(id);
  }
  return [...out];
}

/** True when the candidate's own Steam appid is one of the game's. */
export function steamMatches(game, candidate) {
  const id = Number(candidate?.profile_steam);
  if (!Number.isFinite(id) || id <= 0) return false;
  return steamIds(game).includes(id);
}

/* -------------------------------------------------------------------- scoring -- */

/**
 * Year agreement, scored.
 *
 * Kept separate from the SteamGridDB version because the two databases behave
 * differently: SteamGridDB usually dates an entry from its Steam release, while
 * HLTB dates from the worldwide release, which is much closer to IGDB's
 * earliest-release date. A missing year on either side scores mid - absent data
 * is not evidence either way.
 */
function yearScore(gap) {
  if (gap == null) return 5;
  if (gap === 0) return 15;
  if (gap === 1) return 11;
  if (gap === 2) return 5;
  return 0;
}

function yearGap(years, candidate) {
  const year = candidateYear(candidate);
  if (!years.length || year == null) return null;
  return Math.min(...years.map((y) => Math.abs(y - year)));
}

/**
 * A small tiebreak favouring the entry more people have actually submitted
 * times for.
 *
 * Only a tiebreak. Capped at 3 points against a name score worth 100, so it can
 * separate two equally-plausible entries but can never promote a worse name
 * match. Popularity is not evidence of identity, and a genuinely obscure game
 * must not lose to a famous one that merely resembles it.
 */
function submissionBonus(candidate) {
  const count = Number(candidate?.comp_all_count);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(3, Math.log10(count + 1));
}

/**
 * Scores one HLTB candidate against an IGDB game.
 *
 * `strict: false` turns off the name penalties, and is only for a candidate
 * already proven by Steam id, where the name is a sanity check rather than the
 * evidence.
 */
export function scoreCandidate(
  game,
  candidate,
  variants,
  { strict = true } = {},
) {
  const ours = variants ?? nameVariants(game);
  const theirs = candidateNames(candidate);

  let name = 0;
  let matchedOn = null;
  for (const mine of ours) {
    for (const yours of theirs) {
      const score =
        nameSimilarity(mine.name, yours.name, { strict }) *
        mine.weight *
        yours.weight;
      if (score > name) {
        name = score;
        matchedOn = mine.name;
      }
    }
    if (name === 1) break;
  }

  const conflict = categoryConflict(game, candidate);
  if (strict && conflict) name *= 0.6;

  const gap = yearGap(igdbYears(game), candidate);

  return {
    hltbId: candidate?.game_id ?? null,
    hltbName: candidate?.game_name ?? null,
    name,
    matchedOn,
    yearGap: gap,
    categoryConflict: conflict,
    total: name * 100 + yearScore(gap) + submissionBonus(candidate),
  };
}

const STRONG_NAME = 0.97;

function confidenceFor(name, gap) {
  if (name >= STRONG_NAME && (gap == null || gap <= 1)) return "high";
  return "medium";
}

/**
 * Picks the best of a list of HLTB candidates, or nothing.
 *
 * Candidates failing the name floor, or whose year is further out than a
 * plausible listing difference, are dropped BEFORE anything is chosen - so the
 * only result a search returned cannot win simply by being the only result.
 *
 * `method: "steam"` means the candidates were already confirmed by Steam id, so
 * the name is held to the much lower bridge floor and the year is not consulted
 * at all. That only catches IGDB pointing a game at an unrelated appid.
 *
 * `ambiguous` flags a runner-up that was nearly as good. A warning, not a
 * rejection - but a caller storing the result unattended should treat it as a
 * reason to keep looking.
 */
export function pickBest(game, candidates, { method = "name" } = {}) {
  const variants = nameVariants(game);
  const byId = method === "steam";

  const scored = (candidates ?? [])
    .filter((c) => c && c.game_id != null)
    .map((c) => scoreCandidate(game, c, variants, { strict: !byId }))
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
    hltbId: best.hltbId,
    hltbName: best.hltbName,
    method,
    confidence: byId ? "exact" : confidenceFor(best.name, best.yearGap),
    nameScore: Number(best.name.toFixed(3)),
    matchedOn: best.matchedOn,
    yearGap: best.yearGap,
    ambiguous: Boolean(runnerUp && best.total - runnerUp.total < 6),
    runnerUp: runnerUp
      ? { hltbId: runnerUp.hltbId, hltbName: runnerUp.hltbName }
      : null,
  };
}

/**
 * Which search results are worth spending a detail request on.
 *
 * The detail page is the only place `profile_steam` appears, so confirming a
 * match by Steam id costs one request per candidate checked. The Decky plugin
 * spends up to twenty; that is affordable for one game on demand and is not
 * affordable here.
 *
 * So candidates are ordered by how well they score on name and year alone, and
 * only the most plausible few are ever opened. Anything already below the name
 * floor is dropped outright - a Steam id could only confirm it, and we would
 * refuse it anyway.
 */
export function worthConfirming(game, candidates, limit = 4) {
  const variants = nameVariants(game);
  return (
    (candidates ?? [])
      .filter((c) => c && c.game_id != null)
      .map((c) => ({ candidate: c, score: scoreCandidate(game, c, variants) }))
      // Deliberately looser than NAME_FLOOR: a proven Steam id is allowed to
      // rescue a name we would not have trusted on its own, which is the whole
      // point of checking. "Laser League" vs "Laser League: World Arena" is the
      // shape of case this exists for.
      .filter((entry) => entry.score.name >= BRIDGE_FLOOR)
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, limit)
      .map((entry) => entry.candidate)
  );
}

/** Normalized-name equality, for the cheap exact-hit shortcut. */
export function sameName(a, b) {
  const left = normalizeName(a);
  return Boolean(left) && left === normalizeName(b);
}
