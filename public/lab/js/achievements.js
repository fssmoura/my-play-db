/**
 * Achievement lists across stores: combining them (Library cards and the
 * Achievements tab use the same rules) and loading one game's combined list.
 * Display only: nothing stored changes.
 */
import { supabase } from "/js/supabase.js";

/* Combining. Stores often list the same achievement with a slightly different
   name or description (a typo, punctuation, a reworded title), and a list can
   hold two achievements that differ only by punctuation ("BB" and "BB...").
   So every pair across two lists is scored - name mostly, description as
   backup - and pairs are settled best first, each achievement used once;
   pairs scoring under MATCH_FLOOR stay separate (a PlayStation platinum, a
   store-only extra). Measured on the owner's library (Nov 2026): no wrong
   pairings. */

const MATCH_FLOOR = 0.6;
const loose = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const wordSet = (s) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
const pairsOf = (s) => {
  const t = loose(s);
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};
const dice = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
};
const nameScore = (a, b) =>
  a === b
    ? 1
    : loose(a) === loose(b)
      ? 0.95
      : dice(pairsOf(a), pairsOf(b)) * 0.9;
const descScore = (a, b) => (!a || !b ? 0.5 : dice(wordSet(a), wordSet(b)));
const pairScore = (x, y) =>
  0.6 * nameScore(x.name, y.name) +
  0.4 * descScore(x.description, y.description);

/**
 * One list from several. The first list is the base: each entry keeps its
 * fields, gains `copies` (itself plus every matched achievement from the
 * other lists) and `earned` (earned on any copy). Unmatched achievements from
 * the other lists are added as their own entries.
 */
export function combineLists(all) {
  const master = all[0].map((a) => ({
    ...a,
    earned: !!a.unlocked_at,
    copies: [a],
  }));
  for (const list of all.slice(1)) {
    const pairs = [];
    master.forEach((m, i) =>
      list.forEach((a, j) => {
        const s = pairScore(m, a);
        if (s >= MATCH_FLOOR) pairs.push([s, i, j]);
      }),
    );
    pairs.sort((p, q) => q[0] - p[0]);
    const usedM = new Set();
    const usedL = new Set();
    for (const [, i, j] of pairs) {
      if (usedM.has(i) || usedL.has(j)) continue;
      usedM.add(i);
      usedL.add(j);
      master[i].copies.push(list[j]);
      if (list[j].unlocked_at) master[i].earned = true;
    }
    list.forEach((a, j) => {
      if (!usedL.has(j))
        master.push({ ...a, earned: !!a.unlocked_at, copies: [a] });
    });
  }
  return master;
}

/* One game's list. */

const STORE_NAMES = {
  ps5: "PS5",
  ps4: "PS4",
  ps3: "PS3",
  steam: "Steam",
  epic: "Epic",
  microsoft: "Microsoft",
  ea: "EA",
  rockstar: "Rockstar",
};

export function storeName(row) {
  return STORE_NAMES[row.version] ?? row.version ?? row.platform ?? "?";
}

/**
 * Which store's list is the base: the one with the most information.
 * PlayStation has grades, groups and rarity; Xbox and Epic points and rarity;
 * Steam rarity and sometimes groups; EA and hand-entered lists the least.
 */
function richness(row) {
  if (row.platform === "playstation") return 0;
  if (row.version === "microsoft" || row.version === "epic") return 1;
  if (row.version === "steam") return 2;
  if (row.version === "ea") return 3;
  return 4;
}

const TIER_ORDER = { platinum: 0, gold: 1, silver: 2, bronze: 3 };

/** Platinum, gold, silver, bronze; or most points first. */
function byGrade(a, b) {
  const tier = (TIER_ORDER[a.tier] ?? 4) - (TIER_ORDER[b.tier] ?? 4);
  return tier || (b.points ?? 0) - (a.points ?? 0);
}

/** Unlocked newest first, then locked from most to least common. */
function byProgress(a, b) {
  if (a.unlocked_at && b.unlocked_at)
    return b.unlocked_at.localeCompare(a.unlocked_at);
  if (a.unlocked_at || b.unlocked_at) return a.unlocked_at ? -1 : 1;
  return (b.rarity ?? -1) - (a.rarity ?? -1);
}

/** A PlayStation key's trophy number ("NPWR07466_00:12" -> list, 12). */
function position(key) {
  const [list, id] = String(key).split(":");
  return [list, Number(id)];
}

/**
 * Loads every store's list for an IGDB game and combines them.
 *
 * @returns {Promise<{ main, stores, total, unlocked, groups }>} `main` is the
 *   base store's player_games row (null when nothing is stored); `groups` is
 *   `[{ name, items }]` in display order, `name` null for a flat list. Each
 *   item is the base copy's fields plus `earned`, `unlocked_at` (the first
 *   time it was earned, on any store) and `earnedOn` (that store's row).
 */
export async function loadGameAchievements(igdbId) {
  const { data: owned, error } = await supabase
    .from("player_games")
    .select("id, platform, version, meta, first_played")
    .eq("igdb_id", igdbId);
  if (error) throw new Error(error.message);

  const byRow = new Map();
  const ids = owned.map((r) => r.id);
  for (let from = 0; ids.length; from += 1000) {
    const { data, error: listError } = await supabase
      .from("achievements")
      .select(
        "owned_game_id, platform_key, group_name, name, description, icon, rarity, tier, points, secret, unlocked_at",
      )
      .in("owned_game_id", ids)
      .order("owned_game_id")
      .order("platform_key")
      .range(from, from + 999);
    if (listError) throw new Error(listError.message);
    for (const a of data)
      byRow.set(a.owned_game_id, [...(byRow.get(a.owned_game_id) ?? []), a]);
    if (data.length < 1000) break;
  }

  // A store hiding the player's progress is left out when another shows it.
  const withList = owned.filter((r) => byRow.has(r.id));
  const visible = withList.filter((r) => !r.meta?.progress_hidden);
  const used = (visible.length ? visible : withList).sort(
    (a, b) =>
      richness(a) - richness(b) ||
      byRow.get(b.id).length - byRow.get(a.id).length ||
      unlockedIn(byRow.get(b.id)) - unlockedIn(byRow.get(a.id)),
  );
  if (!used.length)
    return {
      main: null,
      stores: [],
      total: 0,
      unlocked: 0,
      finish: null,
      groups: [],
    };

  const rowsById = new Map(used.map((r) => [r.id, r]));
  const main = used[0];
  const items = combineLists(used.map((r) => byRow.get(r.id))).map((m) => {
    const first = m.copies
      .filter((c) => c.unlocked_at)
      .sort((a, b) => a.unlocked_at.localeCompare(b.unlocked_at))[0];
    return {
      ...m,
      unlocked_at: first?.unlocked_at ?? null,
      earnedOn: first ? rowsById.get(first.owned_game_id) : null,
    };
  });

  // How long it took: from the first time played (PlayStation only) or the
  // first unlock, whichever is earlier, to the platinum or, failing that, the
  // last unlock of a finished list.
  const dates = items
    .map((i) => i.unlocked_at)
    .filter(Boolean)
    .sort();
  const platinum = items.find((i) => i.tier === "platinum" && i.earned);
  const complete = items.length > 0 && items.every((i) => i.earned);
  const started = [...used.map((r) => r.first_played), dates[0]]
    .filter(Boolean)
    .map((d) => new Date(d))
    .sort((a, b) => a - b)[0];
  const finished = platinum?.unlocked_at ?? (complete ? dates.at(-1) : null);

  return {
    main,
    stores: used,
    total: items.length,
    unlocked: items.filter((i) => i.earned).length,
    finish:
      finished && started
        ? {
            kind: platinum ? "Platinum" : "Completed",
            ms: new Date(finished) - started,
          }
        : null,
    groups: groupItems(items, main),
  };
}

function unlockedIn(list) {
  return list.filter((a) => a.unlocked_at).length;
}

/**
 * The base store's groups first, in its own order (PlayStation's base game
 * comes first in trophy order; Steam keeps no order, so its largest group
 * leads), then one group for every other store's extras.
 */
function groupItems(items, main) {
  const own = items.filter((i) => i.owned_game_id === main.id);
  const extras = items.filter((i) => i.owned_game_id !== main.id);

  const named = new Map();
  for (const item of own) {
    const key = item.group_name ?? "";
    if (!named.has(key)) named.set(key, []);
    named.get(key).push(item);
  }
  const first = (list) =>
    list.map((i) => position(i.platform_key)).sort(comparePosition)[0];
  let groups = [...named.entries()].map(([name, list]) => ({
    name: name || null,
    items: list,
  }));
  groups.sort((a, b) =>
    main.platform === "playstation"
      ? comparePosition(first(a.items), first(b.items))
      : b.items.length - a.items.length,
  );
  // A single group is a flat list. Otherwise the base game's group is marked
  // `base`: PlayStation's first (its default trophy group, stored under the
  // game's name) and any unnamed one. Steam's named groups aren't a base game
  // and an add-on, so they keep their names.
  if (groups.length === 1 && !extras.length) groups[0].name = null;
  else
    groups.forEach((g, i) => {
      if (!g.name || (i === 0 && main.platform === "playstation"))
        g.base = true;
    });

  // Achievements only other stores have, together, under a name of our own.
  if (extras.length) groups.push({ name: null, other: true, items: extras });

  for (const g of groups) g.items.sort(SORTS.grade);
  return groups;
}

/**
 * Orders within a group. `grade`: platinum to bronze or most points, then
 * unlocked newest first, then locked most common first. `unlocked`: that
 * second part alone. `rarity`: rarest first, no rarity last.
 */
export const SORTS = {
  grade: (a, b) => byGrade(a, b) || byProgress(a, b),
  unlocked: (a, b) => byProgress(a, b) || byGrade(a, b),
  rarity: (a, b) => (a.rarity ?? 101) - (b.rarity ?? 101) || byProgress(a, b),
};

function comparePosition([la, ia], [lb, ib]) {
  return la.localeCompare(lb) || ia - ib;
}
