/**
 * The game detail page.
 *
 * Renders the stored `games` row, column by column, including the empty ones -
 * the point is to see exactly what the database holds for a game, not to
 * present a designed page. Fields are listed from a fixed table below rather
 * than from whatever keys happen to exist, so the layout never reshuffles and
 * a blank column is visibly blank instead of silently missing.
 *
 * All data decisions live in `game.js`. This file only draws.
 */
import { getGame } from "../game.js";
import {
  getPlaytimes,
  saveHltbId,
  formatPlaytime,
  PLAYTIME_FIELDS,
} from "../hltb.js";
import { gameTypeLabel } from "../ranking.js";
import { go, onNavigate } from "../navigate.js";

let root;

/** How the value in each column should be drawn. */
const TEXT = "text";
const LONG = "long";
const NUMBER = "number";
const GAME_TYPE = "gameType";
const UNIX = "unix";
const STAMP = "stamp";
const STRINGS = "strings";
const IMAGES = "images";
const GAME_IDS = "gameIds";
const GAME_REF = "gameRef";
const JSON_ROWS = "json";

/**
 * Every column of `games`, grouped. Order is fixed on purpose - see the file
 * comment. `player_games` is deliberately absent; ownership comes later.
 */
const SECTIONS = [
  {
    title: "Identity",
    fields: [
      ["id", "IGDB id", NUMBER],
      ["name", "Name", TEXT],
      ["slug", "Slug", TEXT],
      ["game_type", "Game type", GAME_TYPE],
      ["version_title", "Version title", TEXT],
      ["version_parent", "Version of", GAME_REF],
      ["parent_game", "Parent game", GAME_REF],
    ],
  },
  {
    title: "Description",
    fields: [
      ["summary", "Summary", LONG],
      ["storyline", "Storyline", LONG],
      ["genres", "Genres", STRINGS],
    ],
  },
  {
    title: "Release",
    fields: [
      ["first_release_date", "First release", UNIX],
      ["release_dates", "Release dates", JSON_ROWS],
      ["platforms", "Platforms", JSON_ROWS],
    ],
  },
  {
    title: "People",
    fields: [
      ["developer", "Developer", STRINGS],
      ["publisher", "Publisher", STRINGS],
    ],
  },
  {
    title: "Reception",
    fields: [
      ["rating", "Rating", NUMBER],
      ["rating_count", "Rating count", NUMBER],
      ["hypes", "Hypes", NUMBER],
      ["popularity", "Popularity", JSON_ROWS],
    ],
  },
  {
    title: "Media",
    fields: [
      ["screenshots", "Screenshots", IMAGES],
      ["artworks", "Artworks", IMAGES],
      ["videos", "Videos", JSON_ROWS],
    ],
  },
  {
    title: "Related games",
    fields: [
      ["dlcs", "DLCs", GAME_IDS],
      ["expansions", "Expansions", GAME_IDS],
      ["expanded_games", "Expanded games", GAME_IDS],
      ["standalone_expansions", "Standalone expansions", GAME_IDS],
      ["remakes", "Remakes", GAME_IDS],
      ["remasters", "Remasters", GAME_IDS],
      ["bundles", "Bundles", GAME_IDS],
      ["similar_games", "Similar games", GAME_IDS],
    ],
  },
  {
    title: "Links",
    fields: [
      ["collections", "Collections", JSON_ROWS],
      ["franchises", "Franchises", JSON_ROWS],
      ["websites", "Websites", JSON_ROWS],
      ["external_ids", "External ids", JSON_ROWS],
    ],
  },
  {
    title: "Search",
    fields: [
      ["name_normalized", "Normalized name", TEXT],
      ["alternative_names", "Alternative names", JSON_ROWS],
    ],
  },
  {
    title: "Bookkeeping",
    fields: [
      ["synced_at", "Last touched", STAMP],
      ["fully_synced_at", "Last full sync", STAMP],
      ["hltb_synced_at", "Last HLTB check", STAMP],
    ],
  },
];

export async function mount(el) {
  root = el;
  root.innerHTML = `<div class="game-page" id="g-root"></div>`;

  window.addEventListener("popstate", () => restoreFromUrl());
  // pushState doesn't fire popstate, so arriving here from another tab has to
  // be announced explicitly. See navigate.js.
  onNavigate((view) => {
    if (view === "game") restoreFromUrl();
  });

  await restoreFromUrl();
}

/** Guards against a slow load for one id painting over a newer one. */
let sequence = 0;

async function restoreFromUrl() {
  const id = new URLSearchParams(location.search).get("game");

  if (!id) {
    renderEmpty();
    return;
  }
  if (!Number.isFinite(Number(id))) {
    renderMessage(`"${id}" is not a game id.`, true);
    return;
  }

  const mine = ++sequence;
  renderMessage("Loading...");

  try {
    const { row, source, stale } = await getGame(id);
    if (mine !== sequence) return;
    renderGame(row, source, stale);
  } catch (error) {
    if (mine !== sequence) return;
    renderMessage(error.message, true);
  }
}

/** Navigates to another game without a page load. */
export function open(id) {
  go("game", { game: Number(id) });
}

/* ----------------------------------------------------------------- render -- */

function renderEmpty() {
  el().innerHTML = `
    <p class="meta">
      No game selected. Add <code>?game=&lt;igdb id&gt;</code> to the URL -
      for example <a href="?game=119133">?game=119133</a> for Elden Ring.
    </p>`;
}

function renderMessage(text, isError = false) {
  el().innerHTML = `<p class="meta ${isError ? "error" : ""}">${escapeHtml(text)}</p>`;
}

/**
 * The three images that make up a game's identity, as opposed to the
 * screenshots and artworks that are part of its detail. Each shows the first
 * entry of its column, which is by definition the chosen one.
 */
const ART = [
  ["cover", "Cover"],
  ["logo", "Logo"],
  ["banner", "Banner"],
];

function renderArt(row) {
  return ART.map(([column, label]) => {
    const url = row[column]?.[0];
    const frame = url
      ? `<a class="game-art-frame" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
           <img src="${escapeHtml(url)}" alt="" loading="lazy" />
         </a>`
      : `<div class="game-art-frame"><span class="meta">none</span></div>`;

    return `
      <figure class="game-art is-${column}">
        ${frame}
        <figcaption class="meta">${label}</figcaption>
      </figure>`;
  }).join("");
}

function renderGame(row, source, stale) {
  const age = row.fully_synced_at
    ? describeAge(Date.now() - new Date(row.fully_synced_at).getTime())
    : null;

  const status = stale
    ? `IGDB unreachable - showing stored copy from ${age} ago`
    : source === "igdb"
      ? "just pulled from IGDB"
      : `from the database - synced ${age} ago`;

  el().innerHTML = `
    <header class="game-head">
      <div class="game-artset">${renderArt(row)}</div>
      <div class="game-head-body">
        <h2>${escapeHtml(row.name ?? "(no name)")}</h2>
        <p class="meta">
          IGDB ${row.id} &middot; ${escapeHtml(gameTypeLabel(row.game_type))}
          ${row.first_release_date ? ` &middot; ${new Date(row.first_release_date * 1000).getFullYear()}` : ""}
        </p>
        <p class="meta ${stale ? "error" : ""}">${escapeHtml(status)}</p>
        <div class="button-row">
          <button type="button" id="g-refresh">Force refresh</button>
          <button type="button" id="g-media">Select media</button>
          <button type="button" id="g-hltb-refresh">Refresh playtimes</button>
        </div>
      </div>
    </header>

    ${renderSections(row)}
  `;

  el()
    .querySelector("#g-refresh")
    ?.addEventListener("click", async () => {
      renderMessage("Refreshing...");
      try {
        const { row: fresh } = await getGame(row.id, { force: true });
        renderGame(fresh, "igdb", false);
      } catch (error) {
        renderMessage(error.message, true);
      }
    });

  el()
    .querySelector("#g-media")
    ?.addEventListener("click", () => go("media", { media: row.id }));

  el()
    .querySelectorAll("[data-game-id]")
    .forEach((node) =>
      node.addEventListener("click", (event) => {
        event.preventDefault();
        open(node.dataset.gameId);
      }),
    );

  el()
    .querySelector("#g-hltb-refresh")
    ?.addEventListener("click", () => hydrateHltb(row, { force: true }));

  // Deliberately not awaited: playtimes come from a scraped, sometimes slow
  // source and must never hold up the rest of the page.
  hydrateHltb(row);
}

/**
 * Every section in order, with HowLongToBeat sitting after Description.
 *
 * It is not part of SECTIONS because it is not a column of `games` - it is
 * filled in asynchronously after the page has painted. Third place because
 * that is where it reads naturally: what the game is, what it is about, how
 * long it takes.
 */
function renderSections(row) {
  const rendered = SECTIONS.map((section) => renderSection(row, section));
  rendered.splice(
    2,
    0,
    `
    <section class="game-section" id="g-hltb">
      <h3>HowLongToBeat</h3>
      <div id="g-hltb-body"><p class="meta">Checking&hellip;</p></div>
    </section>`,
  );
  return rendered.join("");
}

/* ----------------------------------------------------------- howlongtobeat -- */

/**
 * Fills in the HowLongToBeat section after the page has already painted.
 *
 * Separate from the rest of the render because it is the only part of this page
 * that may go to the network, may be slow, and may come back with nothing. None
 * of those are failures: HLTB does not have every game, and it will be down
 * from time to time. The section always shows all three figures, blank where
 * there is no answer, so a missing playtime looks like a missing playtime
 * rather than something broken.
 */
let hltbSequence = 0;

/**
 * The last answer, kept so the section can be redrawn without going back to the
 * network - which is what opening and closing the id control does.
 */
let hltbResult = null;

/** Whether the manual id control is expanded. Collapsed by default. */
let hltbEditing = false;

async function hydrateHltb(row, opts = {}) {
  const mine = ++hltbSequence;
  const body = () => el().querySelector("#g-hltb-body");
  if (!body()) return;

  if (opts.force) body().innerHTML = `<p class="meta">Checking&hellip;</p>`;

  let result;
  try {
    result = await getPlaytimes(row, opts);
  } catch {
    // getPlaytimes does not throw, but a caller must never depend on that.
    result = { times: null, hltbId: row.hltb_id ?? null, error: null };
  }

  if (mine !== hltbSequence) return;
  hltbResult = result;
  paintHltb(row);
}

/**
 * Draws the section from the last answer and wires its controls.
 *
 * Redrawing wholesale rather than showing and hiding the id control: an earlier
 * version toggled a `hidden` attribute on it, which does nothing at all to a
 * flex row, so the button appeared to be broken. Re-rendering cannot fail that
 * way.
 */
function paintHltb(row) {
  const target = el().querySelector("#g-hltb-body");
  if (!target || !hltbResult) return;

  target.innerHTML = renderHltb(hltbResult);

  target.querySelector("#g-hltb-edit")?.addEventListener("click", () => {
    hltbEditing = true;
    paintHltb(row);
    target.querySelector("#g-hltb-id")?.focus();
  });

  target.querySelector("#g-hltb-cancel")?.addEventListener("click", () => {
    hltbEditing = false;
    paintHltb(row);
  });

  target.querySelector("#g-hltb-save")?.addEventListener("click", async () => {
    const raw = target.querySelector("#g-hltb-id")?.value.trim();
    const id = raw === "" ? null : Number(raw);
    if (raw !== "" && !Number.isFinite(id)) return;
    target.innerHTML = `<p class="meta">Saving&hellip;</p>`;
    try {
      await saveHltbId(row.id, id);
      // The row in hand still holds the old id, so correct it rather than
      // re-reading the whole game.
      row.hltb_id = id;
      row.hltb_synced_at = null;
      hltbEditing = false;
      await hydrateHltb(row, { force: true });
    } catch (error) {
      target.innerHTML = `<p class="meta error">${escapeHtml(error.message)}</p>`;
    }
  });
}

/**
 * Drawn with the same label/value grid as every other section, on purpose.
 *
 * An earlier version used highlighted boxes for the three figures, which made
 * playtimes look more important than the rest of the record simply because they
 * were newer. This page is a wireframe onto what the database holds, and HLTB
 * data is not special.
 *
 * "When was this last checked" is deliberately absent - it is already in
 * Bookkeeping as `Last HLTB check`, alongside the other two sync clocks, which
 * is where someone would look for it.
 */
function renderHltb({ times, hltbId }) {
  const rows = PLAYTIME_FIELDS.map(([key, label]) =>
    field(label, formatPlaytime(times?.[key])),
  ).join("");

  const control = hltbEditing
    ? `<input type="text" id="g-hltb-id" inputmode="numeric" placeholder="HLTB id"
              value="${hltbId == null ? "" : Number(hltbId)}" />
       <button type="button" id="g-hltb-save">Save</button>
       <button type="button" id="g-hltb-cancel">Cancel</button>`
    : `<button type="button" id="g-hltb-edit">Set HLTB id</button>`;

  return `
    <dl class="game-fields">${rows}</dl>
    <div class="button-row spaced-top">${control}</div>`;
}

/** One label/value row, matching `renderSection`. */
function field(label, value) {
  return `
    <div class="game-field ${value == null ? "is-empty" : ""}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${value == null ? `<span class="meta">&mdash;</span>` : value}</dd>
    </div>`;
}

function renderSection(row, section) {
  const rows = section.fields
    .map(([key, label, kind]) => {
      const value = renderValue(row[key], kind);
      const empty = value === null;
      return `
        <div class="game-field ${empty ? "is-empty" : ""}">
          <dt>${escapeHtml(label)}</dt>
          <dd>${empty ? `<span class="meta">&mdash;</span>` : value}</dd>
        </div>`;
    })
    .join("");

  return `
    <section class="game-section">
      <h3>${escapeHtml(section.title)}</h3>
      <dl class="game-fields">${rows}</dl>
    </section>`;
}

/** Returns HTML, or null when there is genuinely nothing stored. */
function renderValue(value, kind) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && !value.length) return null;

  switch (kind) {
    case TEXT:
      return escapeHtml(value);

    case LONG:
      return `<p class="game-prose">${escapeHtml(value)}</p>`;

    case NUMBER:
      return escapeHtml(String(value));

    case GAME_TYPE:
      return `${escapeHtml(gameTypeLabel(value))} <span class="meta">(${value})</span>`;

    case UNIX:
      return `${new Date(value * 1000).toISOString().slice(0, 10)} <span class="meta">(${value})</span>`;

    case STAMP: {
      const date = new Date(value);
      return `${escapeHtml(date.toLocaleString())} <span class="meta">(${describeAge(Date.now() - date.getTime())} ago)</span>`;
    }

    case STRINGS:
      return `<ul class="game-list">${value
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`;

    case IMAGES:
      return `<div class="game-images">${value
        .map(
          (url) =>
            `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
               <img src="${escapeHtml(url)}" alt="" loading="lazy" />
             </a>`,
        )
        .join("")}</div>`;

    case GAME_REF:
      return `<a href="?game=${Number(value)}" data-game-id="${Number(value)}">${Number(value)}</a>`;

    case GAME_IDS:
      return `<div class="game-idlist">${value
        .map(
          (id) =>
            `<a href="?game=${Number(id)}" data-game-id="${Number(id)}">${Number(id)}</a>`,
        )
        .join("")}</div>`;

    case JSON_ROWS:
      return `<pre class="game-json">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;

    default:
      return escapeHtml(String(value));
  }
}

/* ------------------------------------------------------------------ misc -- */

function el() {
  return root.querySelector("#g-root");
}

function describeAge(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "moments";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} days`;
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
