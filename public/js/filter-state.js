// The type filter for search: which result types (see result-types.js) are
// selected. Nothing selected means "all types". No DOM in here - the menu and
// the results page subscribe to "change" and report through toggle()/clear().

export function createFilterState() {
  const selected = new Set();
  const listeners = new Set();
  const countListeners = new Set();
  let counts = null;

  const emit = () => {
    for (const fn of [...listeners]) fn();
  };

  return {
    get values() {
      return [...selected].sort((a, b) => a - b);
    },
    get count() {
      return selected.size;
    },
    has: (value) => selected.has(value),
    toggle(value) {
      if (!selected.delete(value)) selected.add(value);
      emit();
    },
    clear() {
      if (!selected.size) return;
      selected.clear();
      emit();
    },
    // Does a result of this type pass the filter?
    matches: (value) => selected.size === 0 || selected.has(value),
    // How many results there are of each type ({ [value]: n }), or null while
    // there are none to count. Set by the results page, shown by the menu.
    get counts() {
      return counts;
    },
    setCounts(next) {
      counts = next;
      for (const fn of [...countListeners]) fn();
    },
    on(event, fn) {
      const set =
        event === "change" ? listeners : event === "counts" ? countListeners : null;
      if (!set) return () => {};
      set.add(fn);
      return () => set.delete(fn);
    },
  };
}
