/**
 * Client-side navigation between tabs.
 *
 * Exists so one view can send you to another without importing it. Search
 * needs to open a game page; making it `import` the game view would couple two
 * throwaway presentation modules to each other, and the whole point of the
 * views/ split is that any of them can be rewritten alone.
 *
 * `history.pushState` deliberately does not fire `popstate`, so a view that
 * restores itself from the URL would never hear about a programmatic
 * navigation. That is what the subscriber list is for: `go()` updates the URL
 * and then tells everyone, which is the same thing `popstate` would have done.
 */
const listeners = new Set();

/**
 * Called with the target view id whenever `go()` runs.
 * @returns {() => void} an unsubscribe function.
 */
export function onNavigate(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/**
 * Moves to another tab, writing the URL so refresh, sharing and the back
 * button all keep working.
 *
 * @param {string} view tab id, matching `data-view` in index.html
 * @param {object} params query string for the new URL. Replaces it entirely -
 *   tabs own their own parameters and must not inherit each other's.
 */
export function go(view, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ""),
  ).toString();

  history.pushState(
    null,
    "",
    query ? `${location.pathname}?${query}` : location.pathname,
  );

  for (const handler of listeners) handler(view);
}
