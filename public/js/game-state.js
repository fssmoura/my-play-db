// Game page state for the new app: which game's page is open, if any. Like
// search-state.js it knows nothing about the page, the menu or the browser;
// those subscribe to the events below and report back through open() / close().
//
// Events:
//   "open"   ({ id }) a game page opened
//   "close"  ({ id, source }) it closed. source says how: "back", "back-key",
//            "escape", "search" (Search was tapped), "swipe" (dragged down) or
//            "history" (browser back).

export function isGameId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function createGameState() {
  let id = null;
  const listeners = new Map();

  function emit(event, detail) {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(detail);
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }

  function open(next) {
    next = Number(next);
    if (id !== null || !isGameId(next)) return;
    id = next;
    emit("open", { id });
  }

  function close(source = "close") {
    if (id === null) return;
    const closed = id;
    id = null;
    emit("close", { id: closed, source });
  }

  return {
    get id() {
      return id;
    },
    get isOpen() {
      return id !== null;
    },
    open,
    close,
    on,
  };
}
