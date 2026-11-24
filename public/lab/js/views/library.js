import { supabase } from "/js/supabase.js";
import { getAccessToken } from "/js/session.js";
import { gameTypeLabel, releaseYear } from "../ranking.js";
import { go } from "../navigate.js";
import { combineLists } from "../achievements.js";

/**
 * A read-only look at everything owned (player_games), joined to the IGDB
 * details where a match exists. Read-only; a matched card opens its game page.
 *
 * Opening this tab asks the server to sync every platform (each skips if its
 * last sync was under 15 minutes ago); Sync now skips that wait. The sync
 * itself lives in /api/library-sync; this tab only shows its progress.
 */

const SORT_LABELS = {
  recent: "Recently played",
  title: "A-Z",
  playtime: "Most played",
  completion: "Completion",
};

const ICON = (body) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const SORT_ICONS = {
  recent: ICON('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  title: ICON('<path d="M4 17l3-10 3 10M5 14h4"/><path d="M14 7h6l-6 10h6"/>'),
  playtime: ICON(
    '<path d="M6 3h12M6 21h12M7 3c0 5 10 7 10 18M17 3c0 5-10 7-10 18"/>',
  ),
  completion: ICON(
    '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>',
  ),
};

const SORTS = {
  recent: (a, b) => time(b.last_played) - time(a.last_played) || byTitle(a, b),
  title: (a, b) => byTitle(a, b),
  playtime: (a, b) => (b.playtime ?? 0) - (a.playtime ?? 0) || byTitle(a, b),
  // Highest first; games with no achievements or hidden progress go last.
  completion: (a, b) =>
    (completion(b) ?? -1) - (completion(a) ?? -1) || byTitle(a, b),
};

let root;
let rows = [];
let games = [];
let summary = "";
let syncing = false;
let sortBy = "recent";
// Stores to narrow the list to; empty means every game.
const filters = new Set();

export async function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="library">
      <div class="library-toolbar">
        <div class="library-controls">
          <div class="library-sorts" id="l-sort" role="group" aria-label="Sort by">
            ${Object.entries(SORT_LABELS)
              .map(
                ([key, label]) =>
                  `<button type="button" data-sort="${key}" aria-label="${label}" title="${label}" aria-pressed="${String(key === sortBy)}">${SORT_ICONS[key]}</button>`,
              )
              .join("")}
          </div>
          <details class="library-filters" id="l-filter">
            <summary>All stores</summary>
            <div class="library-filter-list" role="group" aria-label="Stores"></div>
          </details>
          <input type="search" id="l-search" class="library-search" placeholder="Search" aria-label="Search the library" />
        </div>
        <button id="l-reload" class="library-sync" type="button">Sync now</button>
      </div>
      <div id="l-grid" class="library-grid"></div>
      <p class="library-toast meta" id="l-status" role="status" aria-live="polite" hidden></p>
    </div>
  `;
  root.querySelector("#l-search").addEventListener("input", applySearch);
  root.querySelector("#l-filter").addEventListener("change", (event) => {
    const box = event.target.closest("input[data-store]");
    if (!box) return;
    if (box.checked) filters.add(box.dataset.store);
    else filters.delete(box.dataset.store);
    render();
  });
  // Clicking anywhere else closes the list.
  document.addEventListener("click", (event) => {
    const list = root.querySelector("#l-filter");
    if (list?.open && !list.contains(event.target)) list.open = false;
  });
  root.querySelector("#l-sort").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sort]");
    if (!button) return;
    sortBy = button.dataset.sort;
    for (const b of root.querySelectorAll("#l-sort button")) {
      b.setAttribute("aria-pressed", String(b === button));
    }
    render();
  });
  root.querySelector("#l-reload").addEventListener("click", () => sync(true));
  // A matched card opens its game page; an unmatched one has nothing to open.
  const grid = root.querySelector("#l-grid");
  const openCard = (event) => {
    const target = event.target.closest("[data-game]");
    if (target) go("game", { game: Number(target.dataset.game) });
  };
  grid.addEventListener("click", openCard);
  grid.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openCard(event);
  });
  await load();
  // Sync whenever this tab is shown (the server skips it if the last sync
  // was under 15 minutes ago), not whenever the lab loads.
  const visible = () => !root.classList.contains("hidden");
  let wasVisible = visible();
  new MutationObserver(() => {
    const now = visible();
    if (now && !wasVisible) sync(false);
    wasVisible = now;
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  if (wasVisible) sync(false);
}

async function load() {
  const { data, error } = await supabase
    .from("player_games")
    .select(
      "id, platform, version, playtime, last_played, meta, igdb_id, games(name, cover, first_release_date, game_type), achievements(count), unlocked:achievements(count), platinum:achievements(count)",
    )
    .not("unlocked.unlocked_at", "is", null)
    .eq("platinum.tier", "platinum")
    .not("platinum.unlocked_at", "is", null);

  if (error) {
    setStatus(`Error: ${error.message}`, true);
    return;
  }

  rows = data.map((row) => ({
    ...row,
    title: row.games?.name ?? row.meta?.name ?? "?",
  }));
  await loadSharedLists();
  // Combining is the slow part, so it runs once per load, not per redraw.
  games = mergeByGame(rows);
  const unmatched = rows.filter((r) => !r.igdb_id).length;
  summary = unmatched ? `${unmatched} not matched to IGDB.` : "";
  render();
}

// Achievement lists of games held on several stores with progress shown,
// by player_games id, for combining on the card.
let lists = new Map();

async function loadSharedLists() {
  const shown = rows.filter(
    (r) =>
      r.igdb_id != null &&
      (r.achievements?.[0]?.count ?? 0) > 0 &&
      !r.meta?.progress_hidden,
  );
  const perGame = new Map();
  for (const r of shown)
    perGame.set(r.igdb_id, [...(perGame.get(r.igdb_id) ?? []), r.id]);
  const ids = [...perGame.values()].filter((g) => g.length > 1).flat();
  const next = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("achievements")
        .select("owned_game_id, name, description, tier, unlocked_at")
        .in("owned_game_id", part)
        .order("owned_game_id")
        .order("platform_key")
        .range(from, from + 999);
      if (error) {
        setStatus(`Error: ${error.message}`, true);
        return;
      }
      for (const a of data)
        next.set(a.owned_game_id, [...(next.get(a.owned_game_id) ?? []), a]);
      if (data.length < 1000) break;
    }
  }
  lists = next;
}

/** Totals for one game across stores: { total, unlocked, platinum }. */
function combinedCounts(all) {
  const master = combineLists(all);
  return {
    total: master.length,
    unlocked: master.filter((m) => m.earned).length,
    platinum: master.filter((m) => m.earned && m.tier === "platinum").length,
  };
}
/** Where a game comes from: the store on PC (Steam, Epic), else the console family. */
function source(row) {
  return row.platform === "pc" ? (row.version ?? "unknown") : row.platform;
}

/**
 * An unknown-store row is only kept as its own entry when no known store has
 * the same IGDB game; otherwise it just feeds that game's last played.
 */
function isCovered(row, list) {
  return (
    source(row) === "unknown" &&
    row.igdb_id != null &&
    list.some((r) => r.igdb_id === row.igdb_id && source(r) !== "unknown")
  );
}

/**
 * One card per IGDB game, so the same game from several platforms is one
 * card. Playtime is added up and last played is the newest. Achievements are
 * the stores' lists combined (see achievements.js), leaving out a store that
 * hides the player's progress when another shows it. Unmatched rows stay on
 * their own. `stores` lists where the game is owned, for the store filters.
 */
function mergeByGame(list) {
  const groups = new Map();
  for (const row of list) {
    const key = row.igdb_id ?? `row-${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    const stores = [
      ...new Set(group.filter((r) => !isCovered(r, group)).map(source)),
    ];
    if (group.length === 1) return { ...group[0], stores };
    const count = (r, field) => r[field]?.[0]?.count ?? 0;
    const times = group.map((r) => r.playtime).filter((t) => t != null);
    const withList = group.filter((r) => count(r, "achievements") > 0);
    const visible = withList.filter((r) => !r.meta?.progress_hidden);
    const progress = (r) => count(r, "unlocked") / count(r, "achievements");
    // Fallback when the lists aren't loaded: the store with most progress.
    const best = (visible.length ? visible : withList).sort(
      (a, b) =>
        progress(b) - progress(a) ||
        count(b, "unlocked") - count(a, "unlocked"),
    )[0];
    const combined =
      visible.length > 1 && visible.every((r) => lists.has(r.id))
        ? combinedCounts(visible.map((r) => lists.get(r.id)))
        : null;
    return {
      ...group[0],
      stores,
      sources: group
        .filter((r) => !isCovered(r, group))
        .map((r) => `${r.platform} · ${r.version ?? "unknown"}`),
      trophies: combined
        ? visible.every((r) => r.platform === "playstation")
        : (best ?? group[0]).platform === "playstation",
      playtime: times.length ? times.reduce((a, b) => a + Number(b), 0) : null,
      last_played:
        group
          .map((r) => r.last_played)
          .filter(Boolean)
          .sort()
          .pop() ?? null,
      meta: {
        progress_hidden: !combined && Boolean(best?.meta?.progress_hidden),
      },
      achievements: [
        { count: combined?.total ?? (best ? count(best, "achievements") : 0) },
      ],
      unlocked: [
        { count: combined?.unlocked ?? (best ? count(best, "unlocked") : 0) },
      ],
      platinum: [
        { count: combined?.platinum ?? (best ? count(best, "platinum") : 0) },
      ],
    };
  });
}

function render() {
  const counts = new Map();
  for (const g of games)
    for (const s of g.stores) counts.set(s, (counts.get(s) ?? 0) + 1);
  const stores = [...counts.keys()].sort((a, b) =>
    platformName(a).localeCompare(platformName(b)),
  );
  // A store that no longer has games (after a sync) stops filtering.
  for (const f of [...filters]) if (!counts.has(f)) filters.delete(f);
  root.querySelector("#l-filter .library-filter-list").innerHTML = stores
    .map(
      (key) =>
        `<label><input type="checkbox" data-store="${escapeHtml(key)}"${filters.has(key) ? " checked" : ""} /> ${escapeHtml(platformName(key))} <span class="meta">${counts.get(key)}</span></label>`,
    )
    .join("");
  const chosen = stores.filter((s) => filters.has(s)).map(platformName);
  root.querySelector("#l-filter summary").textContent = chosen.length
    ? chosen.join(", ")
    : "All stores";

  const sort = SORTS[sortBy] ?? SORTS.recent;
  const list = filters.size
    ? games.filter((g) => g.stores.some((s) => filters.has(s)))
    : games;
  root.querySelector("#l-grid").innerHTML = [...list]
    .sort(sort)
    .map(card)
    .join("");
  applySearch();
}

/** Plain title match on the drawn cards, ignoring case and punctuation. */
function applySearch() {
  const query = loose(root.querySelector("#l-search").value);
  for (const el of root.querySelectorAll("#l-grid .library-card"))
    el.classList.toggle(
      "hidden",
      Boolean(query) && !el.dataset.title.includes(query),
    );
}

let toastTimer;

/** Shows a toast; it stays while a sync reports steps (`sticky`), else fades. */
function setStatus(text, isError = false, { sticky = false } = {}) {
  const status = root.querySelector("#l-status");
  clearTimeout(toastTimer);
  status.textContent = text;
  status.classList.toggle("error", isError);
  status.hidden = !text;
  if (text && !sticky)
    toastTimer = setTimeout(
      () => {
        status.hidden = true;
      },
      isError ? 12000 : 6000,
    );
}

const PLATFORM_NAMES = {
  steam: "Steam",
  epic: "Epic",
  playstation: "PlayStation",
  xbox: "Xbox",
  microsoft: "Microsoft",
  ea: "EA",
  battlenet: "Battle.net",
  riot: "Riot",
  rockstar: "Rockstar",
  other: "Other",
  unknown: "Unknown",
};
const platformName = (p) => PLATFORM_NAMES[p] ?? p;

/** Runs a sync, showing each step it reports, then reloads the list. */
async function sync(force) {
  if (syncing) return;
  syncing = true;
  const button = root.querySelector("#l-reload");
  button.disabled = true;
  setStatus("Syncing...", false, { sticky: true });

  let outcome = null;
  try {
    const token = await getAccessToken();
    if (!token) throw new Error("not signed in");
    const res = await fetch("/api/library-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ force }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(
        safeJson(text)?.error ?? `request failed (${res.status})`,
      );
    }

    // The server sends one JSON object per line as it goes.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const msg = safeJson(line);
        if (!msg) continue;
        if (msg.step)
          setStatus(`${platformName(msg.platform)}: ${msg.step}`, false, {
            sticky: true,
          });
        else outcome = msg;
      }
    }
    if (buffer.trim()) outcome = safeJson(buffer) ?? outcome;
  } catch (err) {
    outcome = { error: err.message };
  }

  syncing = false;
  button.disabled = false;
  if (outcome?.done) await load();
  setStatus(...describe(outcome));
}

function describe(outcome) {
  if (!outcome) return ["Sync ended without an answer.", true];
  if (outcome.error) return [`Sync failed: ${outcome.error}`, true];
  const parts = Object.entries(outcome.platforms ?? {}).map(([p, o]) => {
    const [text, bad] = describePlatform(o);
    return [`${platformName(p)}: ${text}`, bad];
  });
  return [
    [...parts.map(([t]) => t), summary].filter(Boolean).join(" "),
    parts.some(([, bad]) => bad),
  ];
}

function describePlatform(outcome) {
  if (outcome.error) return [`sync failed: ${outcome.error}.`, true];
  if (outcome.busy) return ["a sync is already running."];
  if (outcome.skipped) return [`synced ${since(outcome.last_finished_at)}.`];

  const r = outcome.result ?? {};
  const changes = [
    r.new_games?.length && `${r.new_games.length} new`,
    r.updated && `${r.updated} updated`,
    r.new_unlocks &&
      `${r.new_unlocks} new achievement${r.new_unlocks > 1 ? "s" : ""}`,
    r.match?.review && `${r.match.review} to review`,
    r.removed?.length && `${r.removed.length} left PS Plus`,
  ].filter(Boolean);
  const problems = [
    r.failed?.length && `${r.failed.length} failed`,
    r.match?.error && "matching failed",
    r.unfinished && `${r.unfinished} left for next sync`,
  ].filter(Boolean);
  const text = `${changes.length ? changes.join(", ") : "nothing new"}${
    problems.length ? `; ${problems.join(", ")}` : ""
  }.`;
  return [text, problems.length > 0];
}

function since(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function card(row) {
  const game = row.games;
  const cover = coverUrl(game?.cover);
  const year = game ? releaseYear(game) : null;
  const details = game
    ? [year, gameTypeLabel(game.game_type)].filter(Boolean).join(" · ")
    : "not matched";

  const link =
    row.igdb_id != null
      ? ` library-card-link" data-game="${row.igdb_id}" role="link" tabindex="0`
      : "";

  return `
    <article class="library-card${link}" data-title="${escapeHtml(loose(row.title))}">
      <div class="library-cover">
        ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />` : `<span class="meta">no art</span>`}
      </div>
      <h3 class="library-name">${escapeHtml(row.title)}</h3>
      <p class="meta">${escapeHtml(details)}</p>
      ${(row.sources ?? [`${row.platform} · ${row.version ?? "unknown"}`])
        .map((s) => `<p class="meta">${escapeHtml(s)}</p>`)
        .join("")}
      <p class="meta">${playtime(row.playtime)} · ${lastPlayed(row.last_played)}</p>
      ${achievementLine(row)}
    </article>
  `;
}

/** Unlocked share of achievements (0-1), or null when there's nothing to show. */
function completion(row) {
  const total = row.achievements?.[0]?.count ?? 0;
  if (!total || row.meta?.progress_hidden) return null;
  return (row.unlocked?.[0]?.count ?? 0) / total;
}

/** "unlocked/total · %", or just the total when Steam hides this player's progress. */
function achievementLine(row) {
  const total = row.achievements?.[0]?.count ?? 0;
  if (!total) return "";
  if (row.meta?.progress_hidden) {
    return `<p class="meta" title="Steam doesn't share progress for this game">${total} achievements · progress unavailable</p>`;
  }
  const unlocked = row.unlocked?.[0]?.count ?? 0;
  const noun =
    (row.trophies ?? row.platform === "playstation")
      ? "trophies"
      : "achievements";
  const platinum = row.platinum?.[0]?.count ? " · platinum" : "";
  return `<p class="meta">${unlocked}/${total} ${noun} · ${Math.floor(completion(row) * 100)}%${platinum}</p>`;
}

function loose(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function byTitle(a, b) {
  return a.title.localeCompare(b.title);
}

function time(value) {
  return value ? new Date(value).getTime() : 0;
}

/** The first cover is the chosen one; IGDB's are swapped to a grid-sized image. */
function coverUrl(cover) {
  const url = Array.isArray(cover) ? cover[0] : cover;
  if (!url) return null;
  return url.replace(/\/t_[a-z0-9_]+\//, "/t_cover_big/");
}

function playtime(seconds) {
  if (!seconds) return "not played";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function lastPlayed(value) {
  if (!value) return "never";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
