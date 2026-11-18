import { supabase } from "/js/supabase.js";
import { getAccessToken } from "/js/session.js";
import { gameTypeLabel, releaseYear } from "../ranking.js";

/**
 * A read-only look at everything owned (player_games), joined to the IGDB
 * details where a match exists. Nothing here is clickable.
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
let summary = "";
let syncing = false;
let sortBy = "recent";
let shown = "all";

export async function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="library">
      <nav class="subtabs" id="l-platform" aria-label="Platform"></nav>
      <div class="library-toolbar">
        <div class="library-sorts" id="l-sort" role="group" aria-label="Sort by">
          ${Object.entries(SORT_LABELS)
            .map(
              ([key, label]) =>
                `<button type="button" data-sort="${key}" aria-label="${label}" title="${label}" aria-pressed="${String(key === sortBy)}">${SORT_ICONS[key]}</button>`,
            )
            .join("")}
        </div>
        <button id="l-reload" class="library-sync" type="button">Sync now</button>
      </div>
      <div id="l-grid" class="library-grid"></div>
      <p class="library-toast meta" id="l-status" role="status" aria-live="polite" hidden></p>
    </div>
  `;
  root.querySelector("#l-platform").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-platform]");
    if (!button) return;
    shown = button.dataset.platform;
    render();
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
  const unmatched = rows.filter((r) => !r.igdb_id).length;
  summary = unmatched ? `${unmatched} not matched to IGDB.` : "";
  render();
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
 * The All tab: one card per IGDB game, so the same game from several
 * platforms is one card. Playtime is added up, last played is the newest and
 * achievements come from the platform with the most progress. Unmatched rows
 * stay on their own.
 */
function mergeByGame(list) {
  const groups = new Map();
  for (const row of list) {
    const key = row.igdb_id ?? `row-${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const count = (r, field) => r[field]?.[0]?.count ?? 0;
    const times = group.map((r) => r.playtime).filter((t) => t != null);
    const withList = group.filter((r) => count(r, "achievements") > 0);
    const visible = withList.filter((r) => !r.meta?.progress_hidden);
    const progress = (r) => count(r, "unlocked") / count(r, "achievements");
    // Several stores can share one achievement list, so adding them up would
    // double count: show the one with the most progress instead.
    const best = (visible.length ? visible : withList).sort(
      (a, b) =>
        progress(b) - progress(a) ||
        count(b, "unlocked") - count(a, "unlocked"),
    )[0];
    return {
      ...group[0],
      sources: group
        .filter((r) => !isCovered(r, group))
        .map((r) => `${r.platform} · ${r.version ?? "unknown"}`),
      trophies: (best ?? group[0]).platform === "playstation",
      playtime: times.length ? times.reduce((a, b) => a + Number(b), 0) : null,
      last_played:
        group
          .map((r) => r.last_played)
          .filter(Boolean)
          .sort()
          .pop() ?? null,
      meta: { progress_hidden: Boolean(best?.meta?.progress_hidden) },
      achievements: [{ count: best ? count(best, "achievements") : 0 }],
      unlocked: [{ count: best ? count(best, "unlocked") : 0 }],
      platinum: [{ count: best ? count(best, "platinum") : 0 }],
    };
  });
}

function render() {
  const tabRows = rows.filter((r) => !isCovered(r, rows));
  const sources = [...new Set(tabRows.map(source))].sort((a, b) =>
    platformName(a).localeCompare(platformName(b)),
  );
  if (shown !== "all" && !sources.includes(shown)) shown = "all";
  root.querySelector("#l-platform").innerHTML = ["all", ...sources]
    .map((key) => {
      const count =
        key === "all"
          ? mergeByGame(rows).length
          : tabRows.filter((r) => source(r) === key).length;
      const label = key === "all" ? "All" : platformName(key);
      return `<button type="button" data-platform="${escapeHtml(key)}" aria-selected="${String(key === shown)}">${escapeHtml(label)} <span class="meta">${count}</span></button>`;
    })
    .join("");

  const sort = SORTS[sortBy] ?? SORTS.recent;
  const list =
    shown === "all"
      ? mergeByGame(rows)
      : tabRows.filter((row) => source(row) === shown);
  root.querySelector("#l-grid").innerHTML = list.sort(sort).map(card).join("");
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

  return `
    <article class="library-card">
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
