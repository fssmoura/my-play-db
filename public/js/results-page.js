// The results page: renders a grid of result cards from plain objects
// { title, year, type }, with a skeleton state while loading. For now it shows
// TEMPORARY placeholder data (after a fake delay) whatever the query is; real
// search plugs in later by passing its own loader (or via showLoading() /
// renderResults(items)). It knows nothing about the menu or the lab's search
// code.

import { loadSampleResults } from "/js/sample-results.js";
import { refreshGlass } from "/js/glass-refresh.js";
import { TYPES } from "/js/result-types.js";

// One card: a cover tile (placeholder for now, nothing on top of it), then
// title, then "type · year". Missing year or type simply leaves the dot out.
export function renderCard({ title, year, type, category }) {
  const card = document.createElement("li");
  card.className = "result-card";
  if (category != null) card.dataset.category = category;

  const art = document.createElement("div");
  art.className = "result-cover";

  const name = document.createElement("p");
  name.className = "result-title";
  name.textContent = title;

  const meta = document.createElement("p");
  meta.className = "result-meta";
  meta.textContent = [type, year].filter(Boolean).join(" · ");

  card.append(art, name, meta);
  return card;
}

// A skeleton card: same grid cell and shape as a real card, quiet shimmer.
export function renderSkeletonCard() {
  const card = document.createElement("li");
  card.className = "result-card is-skeleton";
  card.setAttribute("aria-hidden", "true");
  const art = document.createElement("div");
  art.className = "result-cover";
  const name = document.createElement("p");
  name.className = "result-title";
  const meta = document.createElement("p");
  meta.className = "result-meta";
  card.append(art, name, meta);
  return card;
}

// Cards that are ready show now; `pending` skeletons hold the places of those
// still on their way (e.g. the next page of a lazy-loaded list).
export function renderResults(list, items, pending = 0) {
  list.toggleAttribute("aria-busy", pending > 0);
  list.replaceChildren(
    ...items.map(renderCard),
    ...Array.from({ length: pending }, renderSkeletonCard),
  );
}

export function renderLoading(list, count = 12) {
  list.setAttribute("aria-busy", "true");
  list.replaceChildren(...Array.from({ length: count }, renderSkeletonCard));
}

const TRAILING = 12;

// `loader(offset, limit, { types })` resolves { items, hasMore, counts? };
// `counts` ({ [type]: n } for the whole result set) feeds the filter menu's
// per-type numbers - without it they count the loaded items. `types` are
// the selected filter values at the time of the request (empty = all), so real
// search can filter in its request. `filter` (optional, see filter-state.js)
// also hides already-drawn cards that don't match when it changes, and the
// same rule applies to batches that arrive later. The first batch loads on
// entering search; further batches load as the trailing skeletons come within
// about a screen of the viewport. Defaults to the TEMPORARY sample loader.
export function createResultsPage(
  searchState,
  { loader = loadSampleResults, batch = 20, filter = null } = {},
) {
  const element = document.createElement("section");
  element.className = "results";
  element.setAttribute("aria-label", "Results");

  const list = document.createElement("ul");
  list.className = "results-grid";
  element.append(list);

  // Each entry starts fresh; a late batch from an abandoned entry is ignored
  // via the run counter.
  let run = 0;
  let loaded = 0;
  let loading = false;
  let observer = null;
  // Fallback counts from loaded items, for loaders that don't report counts.
  let tally = {};

  function publishCounts(reported) {
    if (!filter) return;
    filter.setCounts(
      reported ?? Object.fromEntries(TYPES.map((t) => [t.value, tally[t.value] || 0])),
    );
  }

  function stop() {
    run++;
    loading = false;
    observer?.disconnect();
    observer = null;
    tally = {};
    filter?.setCounts(null);
  }

  function applyFilter() {
    if (!filter) return;
    for (const card of list.querySelectorAll(".result-card:not(.is-skeleton)")) {
      card.hidden = !filter.matches(
        card.dataset.category === undefined ? null : Number(card.dataset.category),
      );
    }
    refreshGlass();
  }

  function observeTrailing() {
    const first = list.querySelector(".is-skeleton");
    if (!first || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadBatch();
      },
      { rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(first);
  }

  function loadBatch() {
    if (loading) return;
    loading = true;
    observer?.disconnect();
    observer = null;
    const mine = run;
    loader(loaded, batch, { types: filter?.values ?? [] }).then(
      ({ items, hasMore, counts }) => {
        if (mine !== run) return;
        loading = false;
        loaded += items.length;
        for (const item of items) {
          if (item.category != null) tally[item.category] = (tally[item.category] || 0) + 1;
        }
        publishCounts(counts);
        list.querySelectorAll(".is-skeleton").forEach((s) => s.remove());
        list.append(...items.map(renderCard));
        applyFilter();
        list.toggleAttribute("aria-busy", hasMore);
        if (hasMore) {
          list.append(...Array.from({ length: TRAILING }, renderSkeletonCard));
          observeTrailing();
        }
        refreshGlass();
      },
      () => {
        // A failed batch drops its skeletons rather than shimmering forever.
        if (mine !== run) return;
        loading = false;
        list.querySelectorAll(".is-skeleton").forEach((s) => s.remove());
        list.removeAttribute("aria-busy");
        refreshGlass();
      },
    );
  }

  function start() {
    stop();
    loaded = 0;
    window.scrollTo(0, 0);
    renderLoading(list);
    refreshGlass();
    loadBatch();
  }

  const offs = [
    searchState.on("enter", start),
    searchState.on("exit", stop),
    filter?.on("change", applyFilter),
  ].filter(Boolean);
  renderLoading(list);

  return {
    element,
    showLoading: () => {
      stop();
      renderLoading(list);
      refreshGlass();
    },
    renderResults: (items, pending) => {
      stop();
      renderResults(list, items, pending);
      refreshGlass();
    },
    destroy: () => {
      stop();
      offs.forEach((off) => off());
    },
  };
}
