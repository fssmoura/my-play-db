// Search state for the new app: whether search mode is on (the search pill is
// open, the results screen is showing, the Back circle is visible - all one
// state) and the query typed so far. Nothing here knows about the page, the
// menu or the browser - those subscribe to the events below and report back
// through enter() / exit() / setQuery().
//
// Events:
//   "enter"  search mode started
//   "query"  (query) every change of the query; typing only ever does this
//   "exit"   ({ source }) search mode ended; the query is reset to "".
//            source says how: "back", "back-key", "escape" or "history".
//   "cover" / "uncover"  something (the game page) sits on top of search mode.
//            Search stays active and keeps its query; only its controls step
//            aside. Nothing is discarded, unlike "exit".

export function createSearchState() {
  let query = "";
  let active = false;
  let covered = false;
  const listeners = new Map();

  function emit(event, detail) {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(detail);
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }

  function enter() {
    if (active) return;
    active = true;
    emit("enter");
  }

  function setQuery(next) {
    next = String(next ?? "");
    if (next === query) return;
    query = next;
    emit("query", query);
  }

  function cover() {
    if (!active || covered) return;
    covered = true;
    emit("cover");
  }

  function uncover() {
    if (!covered) return;
    covered = false;
    emit("uncover");
  }

  function exit(source = "exit") {
    if (!active) return;
    active = false;
    covered = false;
    setQuery("");
    emit("exit", { source });
  }

  return {
    get query() {
      return query;
    },
    get active() {
      return active;
    },
    get covered() {
      return covered;
    },
    enter,
    cover,
    uncover,
    setQuery,
    exit,
    on,
  };
}
