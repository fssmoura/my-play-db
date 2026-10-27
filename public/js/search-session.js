// The live search session: turns "what's typed" + "which types are selected"
// into a result list and a status. No DOM, no network of its own - the search
// engine (see search.js) is passed in, so a different engine, or a stub, can
// be used. The results page renders what this exposes and nothing more.
//
// FILTER RULES (the owner's words, implemented as a "baked" type set)
//   "If the filter is set before the search, the search should be filtered and
//   the results relevant to that search only. But if the filter is applied
//   after the search occurred, then it should filter what it finds."
//   - A search that starts from an empty query bakes in whatever types are
//     selected at that moment; further keystrokes keep it.
//   - Baked set not empty: any filter change re-runs the search with the new
//     set (clearing it re-runs unfiltered, and that search is unbaked).
//   - Baked set empty: filter changes only hide or show results client-side.
//   - Emptying the query resets baking.
//
// Status: "blank" (nothing typed), "loading" (nothing to show yet), "partial"
// (a head start or narrowed list is showing, the real answer is pending),
// "done" (`failed` is set when IGDB failed and the head start or narrowed list
// was kept), "error". `generation` changes whenever the list starts over (new
// query, new filter), so the page knows to scroll back to the top and reveal
// from the first page again.
//
// Events: "change" (anything above changed).

export function createSearchSession({ searchState, filter, engine }) {
  const DEBOUNCE_MS = engine.DEBOUNCE_MS ?? 300;
  const listeners = new Set();

  let status = "blank";
  let pool = [];
  let baked = [];
  let hasQuery = false;
  let generation = 0;
  let failed = false;
  let run = 0;
  let seenTypes = filter.values.join(",");
  const emit = () => {
    for (const fn of [...listeners]) fn();
  };

  const typeOf = (game) => game.game_type;
  const visibleList = () =>
    baked.length
      ? pool
      : filter.count
        ? pool.filter((game) => filter.matches(typeOf(game)))
        : pool;

  function publishCounts() {
    if (status !== "done" || !pool.length) return filter.setCounts(null);
    const counts = {};
    for (const game of pool) {
      const type = typeOf(game);
      if (type != null) counts[type] = (counts[type] ?? 0) + 1;
    }
    filter.setCounts(counts);
  }

  function set(next, { restart = false } = {}) {
    status = next.status ?? status;
    if ("pool" in next) pool = next.pool;
    if (next.status && next.status !== "done") failed = false;
    if ("failed" in next) failed = next.failed;
    if (restart) generation++;
    publishCounts();
    emit();
  }

  function blank() {
    run++;
    debounced.cancel();
    engine.cancelSearch?.();
    hasQuery = false;
    baked = [];
    set({ status: "blank", pool: [] }, { restart: true });
  }

  async function execute(query) {
    const mine = ++run;
    try {
      const games = await engine.search(query, {
        types: baked,
        onPartial: (partial) => {
          if (mine !== run) return false;
          // A narrowed list for this query beats a head start; keep it.
          if (status === "partial" && pool.length) return false;
          set({ status: "partial", pool: partial });
        },
      });
      if (mine !== run || games === undefined) return;
      set({ status: "done", pool: games });
    } catch {
      if (mine !== run) return;
      // Cached or narrowed results already on screen are kept as the answer.
      if (pool.length && status === "partial") {
        set({ status: "done", failed: true });
      } else {
        set({ status: "error", pool: [] });
      }
    }
  }

  const debounced = debounce(execute, DEBOUNCE_MS);

  function onQuery() {
    if (!searchState.active) return;
    const query = searchState.query.trim();
    if (!query) return blank();

    if (!hasQuery) {
      hasQuery = true;
      baked = filter.values;
    }

    // Whatever is still in flight was for an older query: its head start and
    // answer must not paint over this one.
    run++;

    // Re-rank what we already have for an instant answer, then let the debounce
    // decide when to actually ask.
    const narrowed = engine.narrowLast(query, baked);
    if (narrowed) {
      set({ status: "partial", pool: narrowed }, { restart: true });
    } else if (status !== "loading") {
      set({ status: "loading", pool: [] }, { restart: true });
    }
    // Already loading: leave the skeletons exactly as they are.
    debounced(query);
  }

  function onFilter() {
    // In Library changes the same event but is not a result filter.
    const key = filter.values.join(",");
    if (key === seenTypes) return;
    seenTypes = key;

    if (!searchState.active) return;
    const query = searchState.query.trim();
    if (!query || !hasQuery) return;

    if (baked.length) {
      baked = filter.values;
      debounced.cancel();
      set({ status: "loading", pool: [] }, { restart: true });
      execute(query);
      return;
    }
    // Unbaked: the pool is the whole answer; just show a different slice.
    set({}, { restart: true });
  }

  const offs = [
    searchState.on("enter", onQuery),
    searchState.on("query", onQuery),
    searchState.on("exit", blank),
    filter.on("change", onFilter),
  ];

  return {
    get status() {
      return status;
    },
    // True when IGDB failed but cached or narrowed results are being kept.
    get failed() {
      return failed;
    },
    get generation() {
      return generation;
    },
    // Everything currently passing the filter, best first.
    get visible() {
      return visibleList();
    },
    get bakedTypes() {
      return [...baked];
    },
    on(event, fn) {
      if (event !== "change") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      run++;
      debounced.cancel();
      offs.forEach((off) => off());
      listeners.clear();
    },
  };
}

function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}
