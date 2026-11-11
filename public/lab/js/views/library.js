import { supabase } from "/js/supabase.js";
import { getAccessToken } from "/js/session.js";
import { gameTypeLabel, releaseYear } from "../ranking.js";

/**
 * A read-only look at everything owned (player_games), joined to the IGDB
 * details where a match exists. Nothing here is clickable.
 *
 * Opening this tab asks the server to sync Steam (it skips if the last sync
 * was under 15 minutes ago); Sync now skips that wait. The sync itself lives
 * in /api/library-sync; this tab only shows its progress.
 */

const SORT_LABELS = {
  recent: "Recently played",
  title: "A-Z",
  playtime: "Most played",
  completion: "Completion",
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

export async function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="library">
      <div class="library-head">
        <p class="meta" id="l-status">Loading...</p>
        <button id="l-reload" type="button">Sync now</button>
      </div>
      <nav class="subtabs" id="l-sort" aria-label="Sort by">
        ${Object.entries(SORT_LABELS)
          .map(
            ([key, label]) =>
              `<button type="button" data-sort="${key}" aria-selected="${String(key === sortBy)}">${label}</button>`,
          )
          .join("")}
      </nav>
      <div id="l-grid" class="library-grid"></div>
    </div>
  `;
  root.querySelector("#l-sort").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sort]");
    if (!button) return;
    sortBy = button.dataset.sort;
    for (const b of root.querySelectorAll("#l-sort button")) {
      b.setAttribute("aria-selected", String(b === button));
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
      "id, platform, version, playtime, last_played, meta, igdb_id, games(name, cover, first_release_date, game_type), achievements(count), unlocked:achievements(count)",
    )
    .not("unlocked.unlocked_at", "is", null);

  if (error) {
    setStatus(`Error: ${error.message}`, true);
    return;
  }

  rows = data.map((row) => ({
    ...row,
    title: row.games?.name ?? row.meta?.name ?? "?",
  }));
  const unmatched = rows.filter((r) => !r.igdb_id).length;
  summary = `${rows.length} owned${unmatched ? `, ${unmatched} not matched to IGDB` : ""}`;
  render();
}

function render() {
  const sort = SORTS[sortBy] ?? SORTS.recent;
  root.querySelector("#l-grid").innerHTML = [...rows]
    .sort(sort)
    .map(card)
    .join("");
  if (!syncing) setStatus(`${summary}.`);
}

function setStatus(text, isError = false) {
  const status = root.querySelector("#l-status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

/** Runs a Steam sync, showing each step it reports, then reloads the list. */
async function sync(force) {
  if (syncing) return;
  syncing = true;
  const button = root.querySelector("#l-reload");
  button.disabled = true;
  setStatus("Syncing Steam...");

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
        if (msg.step) setStatus(msg.step);
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
  if (!outcome) return [`${summary}. Sync ended without an answer.`, true];
  if (outcome.error) return [`${summary}. Sync failed: ${outcome.error}`, true];
  if (outcome.busy) return [`${summary}. A sync is already running.`];
  if (outcome.skipped)
    return [`${summary}. Synced ${since(outcome.last_finished_at)}.`];

  const r = outcome.result ?? {};
  const changes = [
    r.new_games?.length && `${r.new_games.length} new`,
    r.updated && `${r.updated} updated`,
    r.new_unlocks &&
      `${r.new_unlocks} new achievement${r.new_unlocks > 1 ? "s" : ""}`,
    r.match?.review && `${r.match.review} to review`,
  ].filter(Boolean);
  const problems = [
    r.failed?.length && `${r.failed.length} failed`,
    r.match?.error && "matching failed",
    r.unfinished && `${r.unfinished} left for next sync`,
  ].filter(Boolean);
  const text = `${summary}. Synced: ${changes.length ? changes.join(", ") : "nothing new"}${
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
      <p class="meta">${escapeHtml(row.platform)} · ${escapeHtml(row.version)}</p>
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
  return `<p class="meta">${unlocked}/${total} achievements · ${Math.floor(completion(row) * 100)}%</p>`;
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
