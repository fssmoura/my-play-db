// The address mirrors the search: /?q=zelda&types=0,1. Written with
// replaceState while typing and filtering (it never adds history entries, and
// keeps the state object the history wiring relies on), read once on load so a
// refresh or a shared link comes back to the same search. No DOM.

const MAX_TYPE = 14;

// { query, types } from a query string; types are integers 0-14, sorted.
export function readUrl(search = location.search) {
  const params = new URLSearchParams(search);
  const query = (params.get("q") ?? "").trim();
  const types = [
    ...new Set(
      (params.get("types") ?? "")
        .split(",")
        .filter((part) => part !== "")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= MAX_TYPE),
    ),
  ].sort((a, b) => a - b);
  return { query, types };
}

export function buildUrl(query, types, path = location.pathname) {
  const params = new URLSearchParams();
  const q = String(query ?? "").trim();
  if (q) {
    params.set("q", q);
    if (types.length) params.set("types", types.join(","));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function wireUrl({ searchState, filter }) {
  const write = () => {
    if (!searchState.active) return;
    history.replaceState(
      history.state,
      "",
      buildUrl(searchState.query, filter.values),
    );
  };
  const offs = [searchState.on("query", write), filter.on("change", write)];
  return () => offs.forEach((off) => off());
}
