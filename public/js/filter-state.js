// The type filter for search: which result types (see result-types.js) are
// selected. Nothing selected means "all types". No DOM in here - the menu and
// the results page subscribe to "change" and report through toggle()/clear().

export function createFilterState() {
  const selected = new Set();
  let inLibrary = false;
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
    // Selected types.
    get count() {
      return selected.size;
    },
    // "Only games I own".
    get inLibrary() {
      return inLibrary;
    },
    // Everything applied: selected types, plus 1 for In Library.
    get total() {
      return selected.size + (inLibrary ? 1 : 0);
    },
    has: (value) => selected.has(value),
    toggle(value) {
      if (!selected.delete(value)) selected.add(value);
      emit();
    },
    // Replaces the selected types (e.g. restoring them from the address).
    set(values) {
      const next = new Set(values);
      if (
        next.size === selected.size &&
        [...next].every((value) => selected.has(value))
      ) {
        return;
      }
      selected.clear();
      for (const value of next) selected.add(value);
      emit();
    },
    toggleInLibrary() {
      inLibrary = !inLibrary;
      emit();
    },
    clear() {
      if (!selected.size && !inLibrary) return;
      selected.clear();
      inLibrary = false;
      emit();
    },
    // Does a result of this type pass the type filter? (In Library is not a
    // result filter yet.)
    matches: (value) => selected.size === 0 || selected.has(value),
    // How many results there are of each type ({ [value]: n }), or null while
    // there are none to count. Set by the search session, shown by the menu.
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
