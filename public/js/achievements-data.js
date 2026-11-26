// One game's achievements for the achievement pages (achievements-page.js):
// loading every store's list, combining them, and the sorts and groupings the
// pages show. Display only: nothing stored changes.
//
// COPY of the lab's lab/js/achievements.js (combineLists, loadGameAchievements,
// groupItems) and lab/js/views/achievements.js (percent, duration,
// withoutPrefix, groupTitle). Fix a bug in one, fix it in both. Changed here:
// each item also carries `store` (its own player_games row), and groups keep
// the store's own order (PlayStation's trophy order) rather than grade order.
//
//   loadGameAchievements(igdbId) -> { main, stores, total, unlocked, finish, groups }
//   arrange(items, sortKey) -> [{ title, items }]
//   sortAvailable(items, sortKey), sortOptions: [{ key, label }]
//   rarityBand(pct), percent(done, total), duration(ms), groupTitle(group, prefixes)
//   summaryLine(result) -> "42/42 unlocked · 100% · Platinum in 2 weeks, 6 days"
import { supabase } from "/js/supabase.js";

/* ---- combining (copied) ---- */

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

function combineLists(all) {
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

/* ---- loading (copied) ---- */

function richness(row) {
  if (row.platform === "playstation") return 0;
  if (row.version === "microsoft" || row.version === "epic") return 1;
  if (row.version === "steam") return 2;
  if (row.version === "ea") return 3;
  return 4;
}

/** A PlayStation key's trophy number ("NPWR07466_00:12" -> list, 12). */
function position(key) {
  const [list, id] = String(key).split(":");
  return [list, Number(id)];
}

function comparePosition([la, ia], [lb, ib]) {
  return la.localeCompare(lb) || ia - ib || 0;
}

const byPosition = (a, b) =>
  comparePosition(position(a.platform_key), position(b.platform_key));

export async function loadGameAchievements(igdbId) {
  const { data: owned, error } = await supabase
    .from("player_games")
    .select("id, platform, version, meta, first_played")
    .eq("igdb_id", Number(igdbId));
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
      store: rowsById.get(m.owned_game_id),
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
  if (groups.length === 1 && !extras.length) groups[0].name = null;
  else
    groups.forEach((g, i) => {
      if (!g.name || (i === 0 && main.platform === "playstation"))
        g.base = true;
    });

  if (extras.length) groups.push({ name: null, other: true, items: extras });

  for (const g of groups) g.items.sort(byPosition);
  return groups;
}

/* ---- wording (copied) ---- */

export function groupTitle(group, prefixes) {
  if (group.base) return "Base Game";
  if (group.other) return "Other";
  if (!group.name) return "All trophies";
  return withoutPrefix(group.name, prefixes);
}

function withoutPrefix(name, prefixes) {
  for (const prefix of prefixes) {
    const want = (prefix ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!want) continue;
    let matched = 0;
    let i = 0;
    for (; i < name.length && matched < want.length; i++) {
      const c = name[i].toLowerCase();
      if (!/[a-z0-9]/.test(c)) continue;
      if (c !== want[matched]) break;
      matched++;
    }
    if (matched < want.length || /[a-z0-9]/i.test(name[i] ?? "")) continue;
    const rest = name.slice(i).replace(/^[\s:\-–—™®©,.]+/, "");
    if (rest && !/^(\d|[IVX]+\b|[([{#])/.test(rest)) return rest;
  }
  return name;
}

/** Whole percent, rounded down so 99.9% never reads as done. */
export function percent(done, total) {
  return `${total ? Math.floor((done / total) * 100) : 0}%`;
}

/** The two largest units: "1 month, 1 week", "3 days, 4 hours", "12 minutes". */
export function duration(ms) {
  const minute = 60000;
  const units = [
    ["year", 365 * 24 * 60 * minute],
    ["month", 30 * 24 * 60 * minute],
    ["week", 7 * 24 * 60 * minute],
    ["day", 24 * 60 * minute],
    ["hour", 60 * minute],
    ["minute", minute],
  ];
  const parts = [];
  let left = Math.max(0, ms);
  for (const [name, size] of units) {
    const n = Math.floor(left / size);
    if (n) parts.push(`${n} ${name}${n === 1 ? "" : "s"}`);
    left -= n * size;
    if (parts.length === 2 || (parts.length && !n)) break;
  }
  return parts.join(", ") || "under a minute";
}

export function summaryLine({ total, unlocked, finish }) {
  if (!total) return "No achievements stored";
  const parts = [`${unlocked}/${total} unlocked`, percent(unlocked, total)];
  if (finish) parts.push(`${finish.kind} in ${duration(finish.ms)}`);
  return parts.join(" · ");
}

/* ---- new for the app: rarity names, sorts and their groups ---- */

export const TIERS = ["platinum", "gold", "silver", "bronze"];

export const BANDS = ["Ultra Rare", "Very Rare", "Rare", "Common"];

/** Sony's names, used everywhere in the app: by share of players who have it. */
export function rarityBand(pct) {
  if (pct == null) return null;
  const n = Number(pct);
  return n < 5
    ? "Ultra Rare"
    : n < 20
      ? "Very Rare"
      : n < 50
        ? "Rare"
        : "Common";
}

/** Xbox and most stores count in G, Epic in XP. */
export function pointsUnit(item) {
  return item.store?.version === "epic" ? "XP" : "G";
}

const newestFirst = (a, b) => b.unlocked_at.localeCompare(a.unlocked_at);
const rarestFirst = (a, b) => (a.rarity ?? 101) - (b.rarity ?? 101);
const tierIndex = (i) => {
  const t = TIERS.indexOf(i.tier);
  return t < 0 ? TIERS.length : t;
};
const hasTiers = (items) => items.some((i) => i.tier);
const hasPoints = (items) => items.some((i) => i.points != null);

export const sortOptions = [
  { key: "default", label: "Default order" },
  { key: "notEarned", label: "Not earned" },
  { key: "rarity", label: "Rarity" },
  { key: "date", label: "Earned date" },
  { key: "grade", label: "Grade" },
];

export function sortAvailable(items, key) {
  if (key === "rarity") return items.some((i) => i.rarity != null);
  if (key === "grade") return hasTiers(items) || hasPoints(items);
  return true;
}

const section = (title, items) => ({ title, items });
const filled = (sections) => sections.filter((s) => s.items.length);

/**
 * A list's items in titled groups for one sort. Items come in the store's
 * own order (the default); each sort keeps that order within a group unless
 * it says otherwise.
 */
export function arrange(items, key, now = new Date()) {
  const earned = items.filter((i) => i.earned);
  const locked = items.filter((i) => !i.earned);

  if (key === "notEarned")
    return filled([
      section("Not earned", locked),
      section("Earned", [...earned].sort(newestFirst)),
    ]);

  if (key === "rarity") {
    const sorted = [...items].sort(rarestFirst);
    return filled([
      ...BANDS.map((band) =>
        section(
          band,
          sorted.filter((i) => rarityBand(i.rarity) === band),
        ),
      ),
      section(
        "Rarity unknown",
        items.filter((i) => i.rarity == null),
      ),
    ]);
  }

  if (key === "date") {
    const day = 24 * 60 * 60 * 1000;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const buckets = {
      today: [],
      week: [],
      month: [],
      older: [],
    };
    for (const i of [...earned].sort(newestFirst)) {
      const at = new Date(i.unlocked_at);
      if (at >= midnight) buckets.today.push(i);
      else if (now - at < 7 * day) buckets.week.push(i);
      else if (now - at < 30 * day) buckets.month.push(i);
      else buckets.older.push(i);
    }
    return filled([
      section("Today", buckets.today),
      section("This Week", buckets.week),
      section("This Month", buckets.month),
      section("More than 30 days ago", buckets.older),
      section("Not earned", locked),
    ]);
  }

  if (key === "grade") {
    if (hasTiers(items))
      return filled([
        ...TIERS.map((t) =>
          section(
            t[0].toUpperCase() + t.slice(1),
            items.filter((i) => i.tier === t),
          ),
        ),
        section(
          "Other",
          items.filter((i) => tierIndex(i) === TIERS.length),
        ),
      ]);
    const values = [
      ...new Set(items.filter((i) => i.points != null).map((i) => i.points)),
    ].sort((a, b) => b - a);
    return filled([
      ...values.map((v) =>
        section(
          `${v} ${pointsUnit(items.find((i) => i.points === v))}`,
          items.filter((i) => i.points === v),
        ),
      ),
      section(
        "No points",
        items.filter((i) => i.points == null),
      ),
    ]);
  }

  // Default: the rarest one earned on its own, then the whole list.
  const rarest = earned.filter((i) => i.rarity != null).sort(rarestFirst)[0];
  return filled([
    section("Rarest trophy earned", rarest ? [rarest] : []),
    section("All trophies", items),
  ]);
}
