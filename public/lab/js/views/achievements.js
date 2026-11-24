/**
 * The Achievements tab: one game's achievements, combined across the stores
 * it is owned on (see ../achievements.js). Reached from a game page's
 * "Achievements" button as `?achievements=<igdb id>`.
 */
import { loadGameAchievements, storeName, SORTS } from "../achievements.js";
import { loadGame } from "../games-cache.js";
import { go, onNavigate } from "../navigate.js";

let root;
let sequence = 0;
let gameId = null;

export async function mount(el) {
  root = el;
  root.innerHTML = `<div class="ach-page" id="a-root"></div>`;

  window.addEventListener("popstate", () => restoreFromUrl());
  onNavigate((view) => {
    if (view === "achievements") restoreFromUrl();
  });

  root.addEventListener("click", (event) => {
    if (event.target.closest("#a-back")) go("game", { game: gameId });
    const sort = event.target.closest("button[data-sort]");
    if (sort) {
      sortBy = sort.dataset.sort;
      openGroups = new Set(
        [...root.querySelectorAll("details.ach-group[open]")].map((d) =>
          Number(d.dataset.group),
        ),
      );
      paint();
      return;
    }
    const reveal = event.target.closest(".ach-reveal");
    if (reveal) {
      reveal.closest(".ach").classList.remove("is-secret");
      reveal.remove();
    }
  });

  await restoreFromUrl();
}

const node = () => root.querySelector("#a-root");

function message(text, isError = false) {
  node().innerHTML = `<p class="meta ${isError ? "error" : ""}">${escapeHtml(text)}</p>`;
}

async function restoreFromUrl() {
  const id = new URLSearchParams(location.search).get("achievements");
  if (!id) return message("Open a game and choose \u201cAchievements\u201d.");
  if (!Number.isFinite(Number(id)))
    return message(`Not a game id: ${id}`, true);

  gameId = Number(id);
  const mine = ++sequence;
  message("Loading\u2026");

  let game;
  let result;
  try {
    [game, result] = await Promise.all([
      loadGame(gameId),
      loadGameAchievements(gameId),
    ]);
  } catch (error) {
    if (mine === sequence) message(error.message, true);
    return;
  }
  if (mine !== sequence) return;
  render(game, result);
}

function render(game, result) {
  last = { game, result };
  openGroups = null;
  paint();
}

/** The last load, so changing the sort redraws without going back to the network. */
let last = null;
let sortBy = "grade";
/** Which groups are open, kept across re-sorts; null means the default (first open). */
let openGroups = null;

const SORT_LABELS = { grade: "Grade", unlocked: "Unlocked", rarity: "Rarity" };

function paint() {
  const { game, result } = last;
  const { main, stores, total, unlocked, finish, groups } = result;
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const head = `
    <header class="ach-head">
      <button type="button" id="a-back" class="link-button">&lsaquo; Back to game</button>
      <h2>${escapeHtml(game?.name ?? `Game ${gameId}`)}</h2>
      <p class="meta">${
        main
          ? `${unlocked}/${total} unlocked &middot; ${percent(unlocked, total)}${
              finish
                ? ` &middot; ${finish.kind} in <strong>${duration(finish.ms)}</strong>`
                : ""
            } &middot; ${escapeHtml(stores.map(storeName).join(", "))}`
          : "No achievements stored for this game."
      }</p>
      ${
        main
          ? `<div class="ach-sorts" role="group" aria-label="Sort by">${Object.entries(
              SORT_LABELS,
            )
              .map(
                ([key, label]) =>
                  `<button type="button" data-sort="${key}" aria-pressed="${String(key === sortBy)}">${label}</button>`,
              )
              .join("")}</div>`
          : ""
      }
    </header>`;

  const body = groups
    // The game's name as IGDB and as the store spell it (PlayStation stores
    // its base group under the game's name).
    .map((group, index, all) => {
      const prefixes = [game?.name, all.find((g) => g.base)?.name];
      const items = [...group.items].sort(SORTS[sortBy]);
      const list = `<ul class="ach-list">${items
        .map((item) => renderItem(item, main, storesById))
        .join("")}</ul>`;
      if (groups.length === 1) return list;
      const done = group.items.filter((i) => i.earned).length;
      const open = openGroups ? openGroups.has(index) : index === 0;
      return `
        <details class="game-section ach-group" data-group="${index}"${open ? " open" : ""}>
          <summary><h3>${escapeHtml(groupTitle(group, prefixes))} <span class="ach-count">${done}/${group.items.length} &middot; ${percent(done, group.items.length)}</span></h3></summary>
          ${list}
        </details>`;
    })
    .join("");

  node().innerHTML = head + body;
}

function groupTitle(group, prefixes) {
  if (group.base) return "Base Game";
  if (group.other) return "Other";
  return withoutPrefix(group.name, prefixes);
}

/**
 * Drops a leading game name from a group name ("Marvel's Midnight Suns: Blood
 * Storm" -> "Blood Storm"), ignoring case, punctuation and ™/®. Only a whole
 * match counts (so "Portal" never eats "Portal 2 ..."), and a name that would
 * end up empty is kept as it is. Display only.
 */
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
    // A number or roman numeral next is a sequel ("HITMAN 2"), not a subtitle;
    // a bracket would be left half-open.
    if (rest && !/^(\d|[IVX]+\b|[([{#])/.test(rest)) return rest;
  }
  return name;
}

/** Whole percent, rounded down so 99.9% never reads as done. */
function percent(done, total) {
  return `${total ? Math.floor((done / total) * 100) : 0}%`;
}

/** The two largest units: "1 month, 1 week", "3 days, 4 hours", "12 minutes". */
function duration(ms) {
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

function renderItem(item, main, storesById) {
  const store = storesById.get(item.owned_game_id);
  const hidden = item.secret && !item.earned;

  return `
    <li class="ach${item.earned ? "" : " is-locked"}${hidden ? " is-secret" : ""}">
      <div class="ach-icon">${
        item.icon
          ? `<img src="${escapeHtml(item.icon)}" alt="" loading="lazy" />`
          : ""
      }</div>
      <div class="ach-body">
        <p class="ach-name">${escapeHtml(item.name)}</p>
        <p class="ach-desc meta">${escapeHtml(item.description ?? "")}</p>
        ${rarity(item.rarity)}
      </div>
      <div class="ach-state" title="${item.earned ? "Unlocked" : "Locked"}">
        ${item.earned ? "" : LOCKED}
        ${
          item.earned
            ? `<span class="ach-when-value">${when(item.unlocked_at)}</span>`
            : ""
        }
      </div>
      ${grade(item, store)}
      ${
        hidden
          ? `<button type="button" class="ach-reveal" aria-label="Reveal secret achievement" title="Reveal">${EYE}</button>`
          : ""
      }
    </li>`;
}

/** The percentage plus one label, worked out the same way for every store. */
function rarity(value) {
  if (value == null) return "";
  const pct = Number(value);
  const label =
    pct < 5
      ? "ultra rare"
      : pct < 10
        ? "very rare"
        : pct < 20
          ? "rare"
          : pct < 50
            ? "uncommon"
            : "common";
  return `<p class="ach-rarity meta">${pct.toFixed(2)}% &middot; ${label}</p>`;
}

/** A trophy cup in its colour (PlayStation), or points (Xbox, Epic). */
function grade(item, store) {
  if (item.tier)
    return `<div class="ach-grade tier-${escapeHtml(item.tier)}" title="${escapeHtml(item.tier)}">${CUP}</div>`;
  if (item.points != null) {
    const unit = store?.version === "epic" ? "XP" : "G";
    return `<div class="ach-grade ach-points">${Number(item.points)} ${unit}</div>`;
  }
  return "";
}

/** Minutes or hours under a day, "yesterday" under two, then the date. */
function when(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const CUP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10v2h4v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 14.9V18h3v2H8v-2h3v-3.1A5 5 0 0 1 7.6 12 5 5 0 0 1 3 7V4h4V2zm0 4H5v1a3 3 0 0 0 2 2.8V6zm10 0v3.8A3 3 0 0 0 19 7V6h-2z"/></svg>`;

const LOCKED = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

const EYE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
