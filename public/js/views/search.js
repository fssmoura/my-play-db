import {
  search,
  narrowLast,
  warmUp,
  debounce,
  latestOnly,
  QUICK_LIMIT,
  PAGE_SIZE,
  DEBOUNCE_MS,
} from "../search.js";
import {
  GAME_TYPES,
  gameTypeLabel,
  releaseYear,
  typeCounts,
  filterByType,
  pageSlice,
  pageCount,
} from "../ranking.js";

/**
 * Everything the view knows, in one place. Nothing is read back out of the
 * DOM - the inputs are set from here, not the other way around.
 */
const state = {
  query: "", // what's in the box
  type: "", // server-side game_type filter
  filter: "", // client-side filter over the results
  page: 0,
  results: [], // the committed search, ranked
  suggestions: [], // top 5 for the dropdown
  highlight: -1, // keyboard selection in the dropdown
  committed: false, // has a search been run
};

/** Only show a "working" message if the wait is long enough to notice. */
const BUSY_AFTER_MS = 250;

let root;
const runSearch = latestOnly((query, type) => search(query, { type }));

export async function mount(el) {
  root = el;
  render();
  warmUp();

  window.addEventListener("popstate", () => restoreFromUrl());
  await restoreFromUrl();
}

/* ------------------------------------------------------------------ shell -- */

function render() {
  root.innerHTML = `
    <div class="search-grid">
      <div class="search-controls">
        <div class="control search-box">
          <label for="s-query">Search IGDB</label>
          <input type="text" id="s-query" autocomplete="off" spellcheck="false"
                 placeholder="Start typing a game name..." />
          <div id="s-suggest" class="suggest hidden"></div>
        </div>
        <div class="control search-type">
          <label for="s-type">Type</label>
          <select id="s-type">
            <option value="">all types</option>
            ${Object.entries(GAME_TYPES)
              .map(
                ([value, label]) =>
                  `<option value="${value}">${label}</option>`,
              )
              .join("")}
          </select>
        </div>
        <button id="s-run" type="button">Search</button>
      </div>

      <p class="meta" id="s-status">Type to see the top ${QUICK_LIMIT} matches. Press Enter for the full list.</p>

      <div class="search-results-head hidden" id="s-results-head">
        <span class="meta" id="s-count"></span>
        <div class="control search-filter">
          <label for="s-filter">Filter results</label>
          <select id="s-filter"></select>
        </div>
      </div>

      <div id="s-results" class="result-list"></div>

      <div class="pager hidden" id="s-pager">
        <button id="s-prev" type="button">Previous</button>
        <span class="meta" id="s-page"></span>
        <button id="s-next" type="button">Next</button>
      </div>
    </div>
  `;

  const input = el("#s-query");
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);
  input.addEventListener("focus", () => {
    if (state.suggestions.length) showSuggestions(true);
  });
  input.addEventListener("blur", () =>
    setTimeout(() => showSuggestions(false), 120),
  );

  el("#s-type").addEventListener("change", () => {
    state.type = el("#s-type").value;
    if (state.query) commit();
  });
  el("#s-run").addEventListener("click", () => commit());
  el("#s-filter").addEventListener("change", () => {
    state.filter = el("#s-filter").value;
    state.page = 0;
    renderResults();
    writeUrl({ push: true });
  });
  el("#s-prev").addEventListener("click", () => goToPage(state.page - 1));
  el("#s-next").addEventListener("click", () => goToPage(state.page + 1));

  el("#s-suggest").addEventListener("mousedown", (event) => {
    const item = event.target.closest("[data-index]");
    if (!item) return;
    event.preventDefault();
    pick(Number(item.dataset.index));
  });
}

function el(selector) {
  return root.querySelector(selector);
}

/* -------------------------------------------------------------- typeahead -- */

function onInput() {
  state.query = el("#s-query").value.trim();
  state.highlight = -1;

  if (!state.query) {
    debouncedPreview.cancel();
    state.suggestions = [];
    showSuggestions(false);
    return;
  }

  // Show something straight away by re-ranking the list we already have. A
  // round trip is ~500ms and can't be made faster, so this is what makes
  // typing feel live; the real answer replaces it when it lands.
  const narrowed = narrowLast(state.query);
  if (narrowed) {
    state.suggestions = narrowed.slice(0, QUICK_LIMIT);
    renderSuggestions();
  } else {
    el("#s-suggest").innerHTML =
      `<div class="suggest-empty meta">Searching...</div>`;
  }
  showSuggestions(true);

  debouncedPreview();
}

const debouncedPreview = debounce(() => preview(), DEBOUNCE_MS);

/** Updates the dropdown. Never touches the committed result list. */
async function preview() {
  if (!state.query) return;

  try {
    const games = await runSearch(state.query, state.type);
    if (games === undefined) return; // superseded by a newer keystroke

    state.suggestions = games.slice(0, QUICK_LIMIT);
    state.highlight = -1;
    renderSuggestions();
    if (document.activeElement === el("#s-query")) showSuggestions(true);
  } catch (error) {
    state.suggestions = [];
    showSuggestions(false);
    setStatus(error.message, true);
  }
}

function renderSuggestions() {
  const box = el("#s-suggest");
  if (!state.suggestions.length) {
    box.innerHTML = `<div class="suggest-empty meta">No matches.</div>`;
    return;
  }

  box.innerHTML = state.suggestions
    .map((game, i) => {
      const year = releaseYear(game);
      return `
        <div class="suggest-item ${i === state.highlight ? "active" : ""}" data-index="${i}">
          <span class="suggest-name">${escapeHtml(game.name)}</span>
          <span class="meta">${escapeHtml(gameTypeLabel(game.game_type))}${
            year ? ` &middot; ${year}` : ""
          }</span>
        </div>`;
    })
    .join("");
}

function showSuggestions(visible) {
  el("#s-suggest").classList.toggle("hidden", !visible);
}

function onKey(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    if (state.highlight >= 0 && state.suggestions[state.highlight])
      pick(state.highlight);
    else commit();
    return;
  }
  if (event.key === "Escape") {
    showSuggestions(false);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  event.preventDefault();
  if (!state.suggestions.length) return;
  const count = state.suggestions.length;
  state.highlight =
    event.key === "ArrowDown"
      ? (state.highlight + 1) % count
      : (state.highlight - 1 + count) % count;
  renderSuggestions();
  showSuggestions(true);
}

function pick(index) {
  const game = state.suggestions[index];
  if (!game) return;
  state.query = game.name;
  el("#s-query").value = game.name;
  commit();
}

/* ----------------------------------------------------------- full results -- */

/**
 * Runs the committed search. The dropdown has usually already fetched this
 * exact query, in which case this is a cache hit and the list appears with no
 * wait at all.
 */
async function commit(restore = null) {
  debouncedPreview.cancel();
  showSuggestions(false);

  if (!state.query) {
    setStatus("Enter something to search for.");
    return;
  }

  const working = setTimeout(() => setStatus("Searching..."), BUSY_AFTER_MS);

  try {
    const games = await runSearch(state.query, state.type);
    if (games === undefined) return; // superseded

    state.results = games;
    state.suggestions = games.slice(0, QUICK_LIMIT);
    state.committed = true;
    state.filter = restore?.filter ?? "";
    state.page = restore?.page ?? 0;

    renderResults();
    if (restore?.updateUrl !== false) writeUrl({ push: !restore });
  } catch (error) {
    state.results = [];
    state.committed = false;
    renderResults();
    setStatus(error.message, true);
  } finally {
    clearTimeout(working);
  }
}

function goToPage(page) {
  const shown = visibleResults();
  state.page = Math.min(Math.max(0, page), pageCount(shown, PAGE_SIZE) - 1);
  renderResults();
  writeUrl({ push: true });
}

function visibleResults() {
  return filterByType(state.results, state.filter);
}

/**
 * Draws the whole result area in one pass - status, filter, count, pager and
 * cards. Everything it needs is already in memory, so this is synchronous:
 * paging and filtering are instant.
 */
function renderResults() {
  const shown = visibleResults();
  const total = pageCount(shown, PAGE_SIZE);
  state.page = Math.min(state.page, total - 1);

  el("#s-results-head").classList.toggle("hidden", !state.committed);
  el("#s-pager").classList.toggle("hidden", shown.length <= PAGE_SIZE);

  if (!state.committed) {
    el("#s-results").innerHTML = "";
    return;
  }

  setStatus(`"${state.query}" - ${state.results.length} result(s).`);

  el("#s-filter").innerHTML = [
    `<option value="">all types (${state.results.length})</option>`,
    ...typeCounts(state.results).map(
      ({ type, count }) =>
        `<option value="${type ?? ""}" ${String(type) === state.filter ? "selected" : ""}>${escapeHtml(
          gameTypeLabel(type),
        )} (${count})</option>`,
    ),
  ].join("");

  const from = shown.length ? state.page * PAGE_SIZE + 1 : 0;
  const to = Math.min(shown.length, (state.page + 1) * PAGE_SIZE);
  el("#s-count").textContent = shown.length
    ? `showing ${from}-${to} of ${shown.length}`
    : "no results";

  el("#s-prev").disabled = state.page === 0;
  el("#s-next").disabled = state.page >= total - 1;
  el("#s-page").textContent = `Page ${state.page + 1} of ${total}`;

  el("#s-results").innerHTML = shown.length
    ? pageSlice(shown, state.page, PAGE_SIZE).map(resultHtml).join("")
    : `<p class="meta">Nothing matches that type filter.</p>`;
}

function resultHtml(game) {
  const year = releaseYear(game);
  const platforms = (game.platforms ?? [])
    .map((p) => p.abbreviation || p.name)
    .filter(Boolean)
    .join(", ");

  return `
    <article class="result">
      <div class="result-cover">
        ${
          game.cover?.url
            ? `<img src="${escapeHtml(game.cover.url)}" alt="" loading="lazy" />`
            : `<span class="meta">no art</span>`
        }
      </div>
      <div class="result-body">
        <h3 class="result-name">${escapeHtml(game.name)}</h3>
        <p class="meta">
          IGDB ${game.id} &middot; ${escapeHtml(gameTypeLabel(game.game_type))}${year ? ` &middot; ${year}` : ""}
        </p>
        ${platforms ? `<p class="meta">${escapeHtml(platforms)}</p>` : ""}
        ${game.summary ? `<p class="result-summary meta">${escapeHtml(game.summary)}</p>` : ""}
      </div>
    </article>
  `;
}

/* -------------------------------------------------------------- url state -- */

/**
 * The committed search lives in the URL, so a result list survives a refresh,
 * can be shared, and the back button steps through pages instead of leaving
 * the app. Typing does not write to the URL - only committing does.
 */
function writeUrl({ push }) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.type !== "") params.set("type", state.type);
  if (state.filter !== "") params.set("filter", state.filter);
  if (state.page > 0) params.set("page", String(state.page + 1));

  const url = params.toString()
    ? `${location.pathname}?${params}`
    : location.pathname;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

async function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  const query = params.get("q");

  if (!query) {
    // Back-navigated to the empty state.
    state.query = "";
    state.results = [];
    state.suggestions = [];
    state.committed = false;
    el("#s-query").value = "";
    showSuggestions(false);
    renderResults();
    setStatus(
      `Type to see the top ${QUICK_LIMIT} matches. Press Enter for the full list.`,
    );
    return;
  }

  state.query = query;
  state.type = params.get("type") ?? "";
  el("#s-query").value = query;
  el("#s-type").value = state.type;

  await commit({
    filter: params.get("filter") ?? "",
    page: Math.max(0, Number(params.get("page") ?? 1) - 1),
    updateUrl: false,
  });
}

/* ------------------------------------------------------------------ misc -- */

function setStatus(text, isError = false) {
  const node = el("#s-status");
  node.textContent = text;
  node.classList.toggle("error", isError);
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
