// The new app's shell: wires the search state, the page switcher, the results
// page, the browser history and the menu together. Each piece knows only the
// small interface of the others; this file is the only place that knows all.
//
// Entering search mode pushes ONE history entry, and opening a game page pushes
// one more (home, then search, then game); leaving by any route (Back, Escape,
// browser back) leaves no stray entry behind.

import { createSearchState } from "/js/search-state.js";
import { createFilterState } from "/js/filter-state.js";
import { createGameState } from "/js/game-state.js";
import { createGamePage } from "/js/game-page.js";
import { createSearchSession } from "/js/search-session.js";
import { createLibrary } from "/js/library.js";
import { storedCovers } from "/js/games-cache.js";
import { preloadImage } from "/js/image-url.js";
import * as searchEngine from "/js/search.js";
import { readUrl, wireUrl } from "/js/url-state.js";
import { createPageSwitcher } from "/js/pages.js";
import { createResultsPage } from "/js/results-page.js";
import { mountMenu, unmountMenu } from "/js/menu.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import { createSyncBar, wirePullToRefresh } from "/js/sync-indicator.js";

// Keeps one history entry in step with the results screen and one with the game
// page. When the page was loaded straight into a search or a game (a refreshed
// or shared link) there is no entry of ours to pop, so leaving rewrites the
// address instead.
function wireHistory(searchState, game) {
  let owns = false; // our entry is the current one
  let pendingPops = 0; // history.back() calls of ours still in flight
  let pendingPush = false; // search re-entered before those finished
  let skipPush = false; // entering because the address already says so
  let gameOwns = false; // the game page's entry is the current one
  let pendingGamePush = false; // game opened before pops finished
  let skipGamePush = false;

  const push = () => {
    history.pushState({ search: true }, "");
    owns = true;
  };

  const pushGame = () => {
    // The game page is its own page: its address carries only the game, not
    // the search beneath it (that entry keeps its own address).
    history.pushState(
      { game: true },
      "",
      `${location.pathname}?game=${game.id}`,
    );
    gameOwns = true;
  };

  const offGameOpen = game.on("open", () => {
    if (skipGamePush) return;
    if (pendingPops > 0) pendingGamePush = true;
    else pushGame();
  });

  const offGameClose = game.on("close", ({ source }) => {
    if (pendingGamePush) {
      pendingGamePush = false;
      return;
    }
    if (source === "history") return;
    if (gameOwns) {
      gameOwns = false;
      pendingPops++;
      history.back();
      return;
    }
    // Loaded straight onto the game page: there is nothing to go back to,
    // so the address becomes home.
    history.replaceState(history.state, "", location.pathname);
  });

  const offEnter = searchState.on("enter", () => {
    if (skipPush) return;
    if (pendingPops > 0) pendingPush = true;
    else push();
  });

  const offExit = searchState.on("exit", ({ source }) => {
    if (pendingPush) {
      pendingPush = false;
      return;
    }
    if (source === "history") return;
    if (owns) {
      owns = false;
      pendingPops++;
      history.back();
    } else if (location.search) {
      history.replaceState(null, "", location.pathname);
    }
  });

  function onPopstate() {
    if (pendingPops > 0) {
      pendingPops--;
      if (pendingPops === 0) {
        if (pendingPush) {
          pendingPush = false;
          if (searchState.active) push();
        }
        if (pendingGamePush) {
          pendingGamePush = false;
          if (game.isOpen) pushGame();
        }
      }
      return;
    }
    // The user went back (button, swipe): our entry is already gone. The game
    // page is the topmost entry, so it goes first.
    if (gameOwns) {
      gameOwns = false;
      game.close("history");
    } else if (owns) {
      owns = false;
      searchState.exit("history");
    }
  }

  window.addEventListener("popstate", onPopstate);
  return {
    // Runs `enter` (which starts search mode) without pushing an entry.
    enterWithoutPush(enter) {
      skipPush = true;
      try {
        enter();
      } finally {
        skipPush = false;
      }
    },
    // Same, for opening the game page because the address already says so.
    openWithoutPush(open) {
      skipGamePush = true;
      try {
        open();
      } finally {
        skipGamePush = false;
      }
    },
    cleanup() {
      offEnter();
      offExit();
      offGameOpen();
      offGameClose();
      window.removeEventListener("popstate", onPopstate);
      // Unmounting (sign-out) is followed by a location.replace, so an async
      // back() would race it; just neutralise our entry instead.
      if (owns || gameOwns) history.replaceState(null, "");
    },
  };
}

let cleanup = null;

export function mountApp() {
  if (cleanup) return;

  const content = document.createElement("main");
  content.id = "app-content";
  document.body.append(content);

  const searchState = createSearchState();
  const pages = createPageSwitcher(content);

  // Today's only page is the existing blank one.
  pages.register("home", document.createElement("section"));
  pages.show("home");

  const game = createGameState();
  const filter = createFilterState();
  const library = createLibrary();
  library.load();
  // Signed in by now (mountApp runs only with a session): bring the stores up
  // to date in the background, once per app load, with the bar showing.
  const syncBar = createSyncBar(library);
  library.sync();
  // The popular list, resolved only once its first page of covers is
  // downloaded and decoded (2s at most), so the cards slide in with their
  // images rather than shimmering after. Custom covers are big SteamGridDB
  // images and need it most.
  const POPULAR_COVERS = 20;
  const popularWithCovers = async () => {
    const games = await searchEngine.popular();
    await Promise.race([
      Promise.all(
        games
          .slice(0, POPULAR_COVERS)
          .map((game) => preloadImage(game.cover?.url, "cover")),
      ),
      new Promise((done) => setTimeout(done, 2000)),
    ]);
    return games;
  };
  const session = createSearchSession({
    searchState,
    filter,
    engine: { ...searchEngine, popular: popularWithCovers },
    library,
  });
  const results = createResultsPage(session, {
    onOpen: (id) => game.open(id),
    isOwned: library.has,
  });
  pages.register("results", results.element);

  const offs = [
    // Refreshed (when over a minute old) so covers and new games are current.
    searchState.on("enter", () => {
      library.load();
      pages.show("results");
    }),
    searchState.on("exit", () => {
      filter.clear();
      pages.back();
    }),
  ];
  const history_ = wireHistory(searchState, game);
  const stopUrl = wireUrl({ searchState, filter, game });
  const scrollIndicator = createOverlayScroll({
    content,
    top: 85,
    bottom: 12,
  });

  mountMenu({ search: searchState, filter, game });
  // Created before the cover wiring below: when the page closes, focus goes
  // back to the card first, and then search may move it into the field.
  const gamePage = createGamePage({
    game,
    content,
    library,
    onProgress: pages.setCovered,
  });
  // The game page sits on top of search: search keeps its query, results and
  // filter, and only its controls step aside.
  offs.push(
    game.on("open", () => searchState.cover()),
    game.on("close", () => searchState.uncover()),
    // Customize saved new art: the card underneath shows the chosen cover.
    game.on("art", async ({ id }) => {
      const cover = (await storedCovers([id])).get(id);
      if (!cover) return;
      library.setCover(id, cover);
      session.setCover(id, cover);
    }),
  );
  searchEngine.warmUp();
  // Pull down on home (nothing on top, no menu open) syncs again, past the
  // 15-minute rule but not the server's 1-minute one. One already running is
  // left to finish.
  const stopPull = wirePullToRefresh({
    canPull: (event) =>
      pages.current === "home" &&
      !searchState.active &&
      !game.isOpen &&
      !library.syncing &&
      !document.querySelector(".is-open") &&
      !event.target.closest?.("input, textarea"),
    onRefresh: () => library.sync({ force: true }),
  });
  // Started while the app sits on home, so opening search doesn't wait.
  const warmPopular = () => popularWithCovers().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(warmPopular);
  else setTimeout(warmPopular, 500);

  // A link with ?game= is a game page on its own (any q is ignored): there is
  // no search underneath. Otherwise a link with ?q= or ?library=1 opens
  // straight into that search, filters applied first, so they count as set
  // before the search.
  const initial = readUrl();
  if (initial.game) {
    const url = `${location.pathname}?game=${initial.game}`;
    if (location.pathname + location.search !== url)
      history.replaceState(history.state, "", url);
    history_.openWithoutPush(() => game.open(initial.game));
  } else if (initial.query || initial.library) {
    filter.set(initial.types);
    filter.setInLibrary(initial.library);
    searchState.setQuery(initial.query);
    history_.enterWithoutPush(() => searchState.enter());
  }

  cleanup = () => {
    stopPull();
    syncBar.destroy();
    scrollIndicator.destroy();
    unmountMenu();
    gamePage.destroy();
    stopUrl();
    history_.cleanup();
    offs.forEach((off) => off());
    results.destroy();
    session.destroy();
    content.remove();
  };
}

export function unmountApp() {
  cleanup?.();
  cleanup = null;
}
