// Page switcher for the new app's content area. A "page" is just an element.
// Switching hides the page being left (it is not destroyed, so it keeps its
// state) and show()/back() bring pages back. Looks live in /css/pages.css.
//
// Covering: when something sits on top of the content (the game page sheet),
// setCovered(t) fades the content out as t goes 0 -> 1 and back in as it
// returns to 0, whatever page is showing. Every future page gets this for free.

export function createPageSwitcher(container) {
  const pages = new Map();
  const trail = [];
  let current = null;

  function register(name, element) {
    element.classList.add("page");
    element.dataset.page = name;
    element.hidden = true;
    pages.set(name, element);
    container.append(element);
  }

  function display(name) {
    for (const [key, element] of pages) element.hidden = key !== name;
    current = name;
  }

  // Go to a page, remembering the one being left.
  function show(name) {
    if (!pages.has(name) || name === current) return;
    if (current) trail.push(current);
    display(name);
  }

  // Return to the page before the last show().
  function back() {
    const previous = trail.pop();
    if (previous) display(previous);
  }

  function setCovered(t) {
    container.style.setProperty("--page-t", (1 - Math.min(t, 1)).toFixed(4));
  }

  return {
    register,
    setCovered,
    show,
    back,
    get current() {
      return current;
    },
  };
}
