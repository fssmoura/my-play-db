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
// IN LIBRARY follows the same rule, against the owner's library (library.js):
//   - Ticked with nothing typed: the whole library shows, most recently played
//     first. Unticked with nothing typed: what's popular right now
//     (engine.popular(), refreshed daily), but only until the first action
//     in this visit to search (typing or a filter change); after that,
//     nothing typed is blank again, as before.
//   - Ticked when a search starts: the search runs through the library only
//     (locally, no IGDB). Unticking it re-runs the search over everything.
//   - Ticked after a search started: games not owned are hidden.
//   Types always only hide cards in a library search, since nothing is asked.
//
// Status: "blank" (nothing typed), "loading" (nothing to show yet), "partial"
// (a head start or narrowed list is showing, the real answer is pending),
// "done" (`failed` is set when IGDB failed and the head start or narrowed list
// was kept), "error". `generation` changes whenever the list starts over (new
// query, new filter), so the page knows to scroll back to the top and reveal
// from the first page again.
//
// Events: "change" (anything above changed).

export function createSearchSession({ searchState, filter, engine, library }) {
  const DEBOUNCE_MS = engine.DEBOUNCE_MS ?? 300;
  // About how long the search bar takes to open (spring.js defaults).
  const POPULAR_SETTLE_MS = 300;
  const listeners = new Set();

  let status = "blank";
  let pool = [];
  // The popular list stands in for results (nothing typed).
  let placeholder = false;
  // Something was typed or a filter changed since search opened.
  let acted = false;
  let baked = [];
  // The search (or the empty-query browse) runs through the library only.
  let libraryBaked = false;
  let hasQuery = false;
  let generation = 0;
  let failed = false;
  let run = 0;
  let seenTypes = filter.values.join(",");
  let seenLibrary = filter.inLibrary;
  const emit = () => {
    for (const fn of [...listeners]) fn();
  };

  const typeOf = (game) => game.game_type;
  const typesHide = () => (libraryBaked || !baked.length) && filter.count > 0;
  const libraryHides = () => filter.inLibrary && !libraryBaked;
  const visibleList = () => {
    let list = pool;
    if (typesHide()) list = list.filter((game) => filter.matches(typeOf(game)));
    if (libraryHides()) list = list.filter((game) => library.has(game.id));
    return list;
  };

  // Each count is what ticking that filter would show, given the other one.
  // The popular stand-in list has no counts: it isn't a result.
  function publishCounts() {
    if (status !== "done" || !pool.length || placeholder) {
      return filter.setCounts(null);
    }
    const counts = {};
    let owned = 0;
    for (const game of pool) {
      const type = typeOf(game);
      const mine = library.has(game.id);
      if (type != null && (!libraryHides() || mine)) {
        counts[type] = (counts[type] ?? 0) + 1;
      }
      if (mine && (!typesHide() || filter.matches(type))) owned++;
    }
    counts.inLibrary = owned;
    filter.setCounts(counts);
  }

  function set(next, { restart = false } = {}) {
    status = next.status ?? status;
    if ("pool" in next) {
      pool = next.pool;
      placeholder = next.placeholder === true;
    }
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
    idle({ restart: true });
  }

  // Leaving search: next time it opens, the popular list shows again.
  function exit() {
    acted = false;
    blank();
  }

  // Nothing typed: the whole library when In Library is ticked, otherwise
  // what's popular right now - but only until the first action (typing or a
  // filter change) in this visit to search; after that it's blank, as before.
  function idle(options) {
    libraryBaked = searchState.active && filter.inLibrary;
    if (libraryBaked) {
      return set(
        library.ready
          ? { status: "done", pool: library.games }
          : { status: "loading", pool: [] },
        options,
      );
    }
    if (!searchState.active || !engine.popular || acted) {
      return set({ status: "blank", pool: [] }, options);
    }
    const mine = ++run;
    // Blank (no skeletons) while the search bar's opening animation runs:
    // painting a grid of covers mid-animation makes it stutter.
    set({ status: "blank", pool: [] }, options);
    const settled = new Promise((done) => setTimeout(done, POPULAR_SETTLE_MS));
    Promise.all([engine.popular(), settled]).then(
      ([games]) => {
        if (mine === run) set({ status: "done", pool: games, placeholder: true });
      },
      () => {
        if (mine === run) set({ status: "blank", pool: [] });
      },
    );
  }

  function searchLibrary(query, options) {
    set(
      library.ready
        ? { status: "done", pool: library.search(query) }
        : { status: "loading", pool: [] },
      options,
    );
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
    acted = true;

    if (!hasQuery) {
      hasQuery = true;
      baked = filter.values;
      libraryBaked = filter.inLibrary;
    }

    // Whatever is still in flight was for an older query: its head start and
    // answer must not paint over this one.
    run++;

    if (libraryBaked) {
      debounced.cancel();
      return searchLibrary(query, { restart: true });
    }

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
    const key = filter.values.join(",");
    const typesChanged = key !== seenTypes;
    const libraryChanged = filter.inLibrary !== seenLibrary;
    seenTypes = key;
    seenLibrary = filter.inLibrary;
    if (!typesChanged && !libraryChanged) return;

    if (!searchState.active) return;
    acted = true;
    const query = searchState.query.trim();
    if (!query || !hasQuery) {
      idle({ restart: true });
      return;
    }

    if (libraryBaked) {
      if (libraryChanged) {
        // The search only looked through the library: unticking it searches
        // everything, keeping the types if they were shaping it.
        libraryBaked = false;
        if (baked.length) baked = filter.values;
        debounced.cancel();
        set({ status: "loading", pool: [] }, { restart: true });
        execute(query);
        return;
      }
      set({}, { restart: true });
      return;
    }

    if (typesChanged && baked.length) {
      baked = filter.values;
      debounced.cancel();
      set({ status: "loading", pool: [] }, { restart: true });
      execute(query);
      return;
    }
    // Unbaked: the pool is the whole answer; just show a different slice.
    set({}, { restart: true });
  }

  // The library arrived or was reloaded: whatever depends on it is redrawn.
  function onLibrary() {
    if (!searchState.active) return;
    const query = searchState.query.trim();
    const options = { restart: status === "loading" };
    if (!query || !hasQuery) {
      if (libraryBaked) idle(options);
      else set({});
    } else if (libraryBaked) {
      searchLibrary(query, options);
    } else {
      // Pills and the In Library filter read the new list.
      set({});
    }
  }

  const offs = [
    searchState.on("enter", onQuery),
    searchState.on("query", onQuery),
    searchState.on("exit", exit),
    filter.on("change", onFilter),
    library.on("change", onLibrary),
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
    // True while the popular list stands in for results (nothing typed).
    get placeholder() {
      return placeholder;
    },
    // Everything currently passing the filter, best first.
    get visible() {
      return visibleList();
    },
    get bakedTypes() {
      return [...baked];
    },
    // A game's cover changed (Customize saved): its card shows the new one.
    // The result objects are shared with the engine's cache, so a repeat of
    // this search shows it too.
    setCover(id, cover) {
      let hit = false;
      for (const game of pool) {
        if (game.id !== Number(id)) continue;
        game.cover = cover;
        hit = true;
      }
      if (hit) emit();
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
