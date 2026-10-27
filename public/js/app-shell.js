// The new app's shell: wires the search state, the page switcher, the results
// page, the browser history and the menu together. Each piece knows only the
// small interface of the others; this file is the only place that knows all.
//
// Entering search mode pushes ONE history entry; leaving by any route (Back,
// Escape, browser back) leaves no stray entry behind.

import { createSearchState } from "/js/search-state.js";
import { createFilterState } from "/js/filter-state.js";
import { createPageSwitcher } from "/js/pages.js";
import { createResultsPage } from "/js/results-page.js";
import { mountMenu, unmountMenu } from "/js/menu.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";

// Keeps one history entry in step with the results screen.
function wireHistory(searchState) {
  let owns = false; // our entry is the current one
  let pendingPops = 0; // history.back() calls of ours still in flight
  let pendingPush = false; // search re-entered before those finished

  const push = () => {
    history.pushState({ search: true }, "");
    owns = true;
  };

  const offEnter = searchState.on("enter", () => {
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
    }
  });

  function onPopstate() {
    if (pendingPops > 0) {
      pendingPops--;
      if (pendingPops === 0 && pendingPush) {
        pendingPush = false;
        if (searchState.active) push();
      }
      return;
    }
    // The user went back (button, swipe): our entry is already gone.
    if (owns) {
      owns = false;
      searchState.exit("history");
    }
  }

  window.addEventListener("popstate", onPopstate);
  return () => {
    offEnter();
    offExit();
    window.removeEventListener("popstate", onPopstate);
    // Unmounting (sign-out) is followed by a location.replace, so an async
    // back() would race it; just neutralise our entry instead.
    if (owns) history.replaceState(null, "");
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

  const filter = createFilterState();
  const results = createResultsPage(searchState, { filter });
  pages.register("results", results.element);

  const offs = [
    searchState.on("enter", () => pages.show("results")),
    searchState.on("exit", () => {
      filter.clear();
      pages.back();
    }),
  ];
  const stopHistory = wireHistory(searchState);
  const scrollIndicator = createOverlayScroll({
    content,
    top: 85,
    bottom: 12,
  });

  mountMenu({ search: searchState, filter });

  cleanup = () => {
    scrollIndicator.destroy();
    unmountMenu();
    stopHistory();
    offs.forEach((off) => off());
    results.destroy();
    content.remove();
  };
}

export function unmountApp() {
  cleanup?.();
  cleanup = null;
}
