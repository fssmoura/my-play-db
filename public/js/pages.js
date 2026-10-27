// Page switcher for the new app's content area. A "page" is just an element.
// Switching hides the page being left (it is not destroyed, so it keeps its
// state) and show()/back() bring pages back. Looks live in /css/pages.css.

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

  return {
    register,
    show,
    back,
    get current() {
      return current;
    },
  };
}
