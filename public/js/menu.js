// Top-right app menu. Behaviour only - all looks live in /css/menu.css.
// To add a pill button, add one entry to PILL_ITEMS; to add a pull-down entry,
// add one to MENU_ITEMS.
//
// The glass is drawn by liquidGL (MIT, WebGPU -> WebGL -> CSS fallback), on
// both the pill and the pull-down. It is a patched copy in /vendor - see the
// note at the top of that file. If it fails to load, the menu still works,
// just without glass.

import { signOut } from "/js/session.js";
import { createSpring } from "/js/spring.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import { TYPES, COMMON_TYPES } from "/js/result-types.js";

const LIQUID_GL_URL = "/vendor/liquidGL.js";
const LIQUID_GL_HELPER_URL =
  "https://cdn.jsdelivr.net/npm/liquid-gl@3.0.0/liquidGL-helper.js";

// Icons: viewBox plus inner markup. "fill" icons are solid, "stroke" icons
// are outlines whose weight is --icon-stroke in menu.css.
const ICONS = {
  back: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path d="M19 11H7.14l3.63-4.36a1 1 0 1 0-1.54-1.28l-5 6a1 1 0 0 0-.09.15c0 .05 0 .08-.07.13A1 1 0 0 0 4 12a1 1 0 0 0 .07.36c0 .05 0 .08.07.13a1 1 0 0 0 .09.15l5 6A1 1 0 0 0 10 19a1 1 0 0 0 .64-.23a1 1 0 0 0 .13-1.41L7.14 13H19a1 1 0 0 0 0-2" />',
  },
  // Filled circle with an x cut out (evenodd), like SF "xmark.circle.fill".
  clear: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path fill-rule="evenodd" d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10s10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17L12 13.41L8.41 17L7 15.59L10.59 12L7 8.41L8.41 7L12 10.59L15.59 7L17 8.41L13.41 12z" />',
  },
  filter: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path d="M21 3H5a1 1 0 0 0-1 1v2.59c0 .523.213 1.037.583 1.407L10 13.414V21a1 1 0 0 0 1.447.895l4-2c.339-.17.553-.516.553-.895v-5.586l5.417-5.417c.37-.37.583-.884.583-1.407V4a1 1 0 0 0-1-1m-6.707 9.293A1 1 0 0 0 14 13v5.382l-2 1V13a1 1 0 0 0-.293-.707L6 6.59V5h14.001l.002 1.583z" />',
  },
  // Selected-item checkmark in the filter pull-down.
  check: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path d="M9.55 18.2 3.65 12.3l1.4-1.4 4.5 4.5 9.4-9.4 1.4 1.4z" />',
  },
  search: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path d="M10 18a7.95 7.95 0 0 0 4.897-1.688l4.396 4.396l1.414-1.414l-4.396-4.396A7.95 7.95 0 0 0 18 10c0-4.411-3.589-8-8-8s-8 3.589-8 8s3.589 8 8 8m0-14c3.309 0 6 2.691 6 6s-2.691 6-6 6s-6-2.691-6-6s2.691-6 6-6" />',
  },
  profile: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5s-5 2.24-5 5s2.24 5 5 5m0-8c1.65 0 3 1.35 3 3s-1.35 3-3 3s-3-1.35-3-3s1.35-3 3-3M4 22h16c.55 0 1-.45 1-1v-1c0-3.86-3.14-7-7-7h-4c-3.86 0-7 3.14-7 7v1c0 .55.45 1 1 1m6-7h4c2.76 0 5 2.24 5 5H5c0-2.76 2.24-5 5-5" />',
  },
  more: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path fill-rule="evenodd" d="M2 12a2 2 0 1 1 4 0a2 2 0 0 1-4 0m8 0a2 2 0 1 1 4 0a2 2 0 0 1-4 0m8 0a2 2 0 1 1 4 0a2 2 0 0 1-4 0" clip-rule="evenodd" />',
  },
  signOut: {
    viewBox: "0 0 24 24",
    style: "fill",
    markup:
      '<path d="M9 13h7v-2H9V7l-6 5l6 5z" /><path d="M19 3h-7v2h7v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2" />',
  },
  lab: {
    viewBox: "0 0 48 48",
    style: "stroke",
    markup:
      '<path d="m10.777 30l7.242-14.961V4h12.01v11.039L37.245 30" /><path d="M7.794 43.673a3.273 3.273 0 0 1-1.52-4.372L10.777 30S18 35 24 30s13.246 0 13.246 0l4.49 9.305A3.273 3.273 0 0 1 38.787 44H9.22c-.494 0-.981-.112-1.426-.327Z" />',
  },
};

// Buttons in the pill, left to right. "opens" is what a button opens: Search
// splits a search pill off the main pill, More opens the pull-down. Profile
// does nothing yet.
const PILL_ITEMS = [
  { id: "search", label: "Search", icon: "search", opens: "search" },
  { id: "profile", label: "Profile", icon: "profile" },
  { id: "more", label: "More", icon: "more", opens: "pull-down" },
];

// Entries in the pull-down opened by "More". Each has either an `href` or an
// `action`; `destructive` gives it the red critical-action look;
// `separatorBefore` starts a new group with a thin divider.
const MENU_ITEMS = [
  { icon: "lab", label: "Switch Environment", href: "/lab/" },
  {
    icon: "signOut",
    label: "Sign Out",
    action: "signOut",
    destructive: true,
    separatorBefore: true,
  },
];

// Owner-specified liquidGL settings, tuned on liquidGL's "Tinted Glass" demo
// card (380px wide). Applied as given, except bevelWidth: liquidGL measures it
// as a fraction of the lens's shorter side, so the same number makes a 4.5px
// rim on that card and a 0.5px one on a 44px pill. fitBevel() rescales it per
// lens so every lens gets the rim the owner saw on the demo card.
// Tune with HELPER = true for liquidGL's live sliders (localhost only).
const BEVEL_REFERENCE_PX = 380;
const GLASS_CONFIG = {
  snapshot: "body",
  resolution: 2,
  refraction: 0.04,
  aberration: 0,
  bevelDepth: 0.06,
  bevelWidth: 0.02,
  frost: 0,
  // Smooth blur in CSS px (vendor patch; replaces the grainy `frost`).
  blur: 8,
  shadow: true,
  specular: true,
  reveal: "fade",
  tilt: false,
  tiltFactor: 5,
  tiltEase: 400,
  draggable: false,
  interaction: "none",
  interactionStrength: 0.5,
  interactionRadius: 0.35,
  interactionViscosity: 0.65,
  magnify: 1.03,
  tint: "rgba(255, 255, 255, 0.06)",
  helper: false,
};

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
// Off: its panel covers the page. Flip to true while tuning GLASS_CONFIG.
const HELPER = IS_LOCAL && false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

function iconSvg(name) {
  const icon = ICONS[name];
  return `<svg class="menu-icon menu-icon-${icon.style}" viewBox="${icon.viewBox}" aria-hidden="true">${icon.markup}</svg>`;
}

function buildPillItem(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  button.title = item.label;
  button.setAttribute("aria-label", item.label);
  button.innerHTML = iconSvg(item.icon);
  if (item.opens) {
    button.dataset.opens = item.opens;
    if (item.opens === "pull-down")
      button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
  }
  // The search button sits in a slot that shrinks to nothing while the
  // search pill is open, so the main pill closes up around Profile and More.
  if (item.opens === "search") {
    const slot = document.createElement("div");
    slot.className = "menu-slot";
    slot.append(button);
    return slot;
  }
  return button;
}

// The second pill: the search icon plus a text field. The pill itself is a
// liquidGL lens, so the contents live in a row inside it (like the main pill).
function buildSearchPill() {
  const pill = document.createElement("div");
  pill.id = "app-search";
  pill.className = "menu-search";

  const row = document.createElement("div");
  row.className = "menu-search-row";

  const icon = document.createElement("span");
  icon.className = "menu-search-icon";
  icon.innerHTML = iconSvg("search");

  const input = document.createElement("input");
  input.className = "menu-search-input";
  input.type = "search";
  input.placeholder = "Search";
  input.setAttribute("aria-label", "Search");
  input.enterKeyHint = "search";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.setAttribute("autocorrect", "off");
  input.spellcheck = false;

  // Shown only while the field has text (the pill's has-text class).
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "menu-search-clear";
  clear.setAttribute("aria-label", "Clear");
  clear.innerHTML = iconSvg("clear");

  row.append(icon, input, clear);
  pill.append(row);
  return { pill, input, clear };
}

// The Back circle at the top left: a lens of its own, shown only while the
// results screen is open. Same classes as the main pill (.menu, .menu-row,
// .menu-item) so size, icon, halo, press and focus rules are shared.
function buildBackButton() {
  const circle = document.createElement("div");
  circle.id = "app-back";
  circle.className = "menu menu-back";

  const row = document.createElement("div");
  row.className = "menu-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  button.title = "Back";
  button.setAttribute("aria-label", "Back");
  button.innerHTML = iconSvg("back");

  row.append(button);
  circle.append(row);
  return { circle, button };
}

// The filter circle, left of the search pill: a lens like the Back circle
// (same classes, so size, icon, halo, press and focus rules are shared). Its
// width follows --search-t, so it grows out with the search pill. The badge
// shows how many types are selected.
function buildFilterButton() {
  const circle = document.createElement("div");
  circle.id = "app-filter";
  circle.className = "menu menu-filter";

  const row = document.createElement("div");
  row.className = "menu-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  button.title = "Filter";
  button.setAttribute("aria-label", "Filter");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = iconSvg("filter");

  const badge = document.createElement("span");
  badge.className = "menu-filter-badge";
  badge.hidden = true;
  badge.setAttribute("aria-hidden", "true");

  row.append(button);
  circle.append(row);
  // The badge sits beside the lens, not in it, so the circle's edge can't clip
  // it; the wrapper carries the sizing and the badge straddles the rim.
  const wrap = document.createElement("div");
  wrap.className = "menu-filter-wrap";
  wrap.append(circle, badge);
  return { wrap, circle, button, badge };
}

// The type pull-down: a short list of common types plus "See more" (which
// swaps in all 15, in place), then a divider and a destructive "Clear all".
// No "All types" row - none selected means all. Rows are built once; wireFilter
// decides which are shown.
function buildFilterPanel() {
  const panel = document.createElement("div");
  panel.id = "app-filter-panel";
  panel.className = "menu-panel menu-filter-panel";
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "Filter by type");

  const list = document.createElement("div");
  list.className = "menu-panel-scroll overlay-scroll-host";
  const rows = new Map();
  for (const type of TYPES) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-panel-item menu-panel-check";
    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("aria-checked", "false");
    item.dataset.value = type.value;
    item.innerHTML = `<span class="menu-panel-label">${type.label}<span class="menu-panel-count"></span></span>${iconSvg("check")}`;
    rows.set(type.value, item);
  }

  const more = document.createElement("button");
  more.type = "button";
  more.className = "menu-panel-item menu-filter-more";
  more.setAttribute("role", "menuitem");
  more.innerHTML = '<span class="menu-panel-label">See more</span>';

  const line = document.createElement("div");
  line.className = "menu-panel-separator";
  line.setAttribute("role", "separator");

  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className =
    "menu-panel-item menu-panel-item-destructive menu-filter-clear";
  clearAll.setAttribute("role", "menuitem");
  clearAll.disabled = true;
  clearAll.innerHTML = '<span class="menu-panel-label">Clear all</span>';

  panel.append(list, line, clearAll);
  return { panel, list, rows, more, clearAll };
}

// Keeps the filter button, badge and panel in step with the filter state, and
// reports toggles back to it. Choosing a type keeps the panel open. Returns
// { prepare, cleanup }: call prepare() just before the panel opens (it picks
// the short list, or the full one when a selected type is only in the full
// list, so the selection is visible).
function wireFilter({
  circle,
  button,
  badge,
  panel,
  list,
  rows,
  more,
  clearAll,
  filter,
  search,
}) {
  const checks = () => [...list.querySelectorAll('[role="menuitemcheckbox"]')];
  let full = false;
  // "See more" appends to the short list rather than reordering it, so the
  // rows already on screen stay put while the panel grows.
  const FULL_ORDER = [
    ...COMMON_TYPES,
    ...TYPES.map((t) => t.value).filter((v) => !COMMON_TYPES.includes(v)),
  ];

  function render() {
    const shown = full
      ? FULL_ORDER.map((v) => rows.get(v))
      : [...COMMON_TYPES.map((v) => rows.get(v)), more];
    list.replaceChildren(...shown);
    panel.classList.toggle("is-full", full);
  }

  // The list's height is animated by a spring (liquidGL forces transition:
  // none on lenses, and watches the lens's size, so the glass follows each
  // frame). Inline height only exists while it runs.
  let fromH = 0;
  let toH = 0;
  const grow = createSpring({
    onUpdate: (v) => {
      list.style.height = `${fromH + (toH - fromH) * v}px`;
    },
    onRest: (target) => {
      if (target !== 1) return;
      list.style.height = "";
      list.classList.remove("is-resizing");
    },
  });
  const settle = () => {
    grow.to(0, { instant: true });
    list.style.height = "";
    list.classList.remove("is-resizing");
  };

  // Fix the panel's width once, to its widest row of the full list with room
  // for counts, so neither "See more" nor counts arriving change it.
  let widthFixed = false;
  function fixWidth() {
    if (widthFixed) return;
    widthFixed = true;
    const wasFull = full;
    full = true;
    render();
    const labels = [...rows.values()].map((r) => r.querySelector(".menu-panel-count"));
    labels.forEach((c) => (c.textContent = " (999)"));
    panel.classList.add("is-measuring");
    const width = Math.ceil(panel.getBoundingClientRect().width);
    panel.classList.remove("is-measuring");
    panel.style.setProperty("--filter-w", `${Math.max(220, width)}px`);
    full = wasFull;
    syncCounts();
    render();
  }

  function syncCounts() {
    const counts = filter.counts;
    panel.classList.toggle("has-counts", counts !== null);
    for (const [value, row] of rows) {
      row.querySelector(".menu-panel-count").textContent =
        counts === null ? "" : ` (${counts[value] ?? 0})`;
    }
  }

  function sync() {
    const count = filter.count;
    badge.hidden = count === 0;
    badge.textContent = String(count);
    button.setAttribute(
      "aria-label",
      count ? `Filter, ${count} selected` : "Filter",
    );
    button.title = button.getAttribute("aria-label");
    for (const [value, row] of rows) {
      row.setAttribute("aria-checked", String(filter.has(value)));
    }
    clearAll.disabled = count === 0;
  }

  const onList = (event) => {
    const item = event.target.closest("button");
    if (!item) return;
    if (item === more) {
      const from = list.getBoundingClientRect().height;
      full = true;
      render();
      // Focus moves to the first row the swap revealed.
      rows.get(FULL_ORDER[COMMON_TYPES.length]).focus({ preventScroll: true });
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const to = list.getBoundingClientRect().height;
      if (to <= from) return;
      settle();
      fromH = from;
      toH = to;
      list.style.height = `${from}px`;
      list.classList.add("is-resizing");
      grow.to(1);
      return;
    }
    if (item.matches('[role="menuitemcheckbox"]')) {
      filter.toggle(Number(item.dataset.value));
    }
  };
  const onClearAll = (event) => {
    filter.clear();
    // A disabled button loses focus; keep keyboard users in the menu.
    if (event.detail === 0) checks()[0]?.focus();
  };
  const closePanel = () => {
    panel.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    if (circle.contains(document.activeElement)) document.activeElement.blur();
  };

  list.addEventListener("click", onList);
  const overlay = createOverlayScroll({ scroller: list, host: panel, top: 6, bottom: 6 });
  clearAll.addEventListener("click", onClearAll);
  const offChange = filter.on("change", sync);
  const offCounts = filter.on("counts", syncCounts);
  const offExit = search.on("exit", closePanel);
  render();
  sync();
  syncCounts();
  return {
    prepare() {
      settle();
      fixWidth();
      full = filter.values.some((v) => !COMMON_TYPES.includes(v));
      render();
    },
    cleanup() {
      grow.destroy();
      overlay.destroy();
      list.removeEventListener("click", onList);
      clearAll.removeEventListener("click", onClearAll);
      offChange();
      offCounts();
      offExit();
    },
  };
}

// Slides the Back circle in and out with --back-t (0 hidden, 1 shown) on the
// stage, driven by the same kind of spring as the search pill. Clicking it
// leaves search mode.
function wireBack({ stage, circle, button, search }) {
  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spring = createSpring({
    onUpdate: (v) => stage.style.setProperty("--back-t", v.toFixed(4)),
    onRest: (target) => {
      if (target === 0) stage.classList.remove("is-back-active");
    },
  });

  function show(visible) {
    if (visible) stage.classList.add("is-back-active");
    else if (circle.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    spring.to(visible ? 1 : 0, { instant: reducedMotion() });
  }

  const onClick = (event) =>
    search.exit(event.detail === 0 ? "back-key" : "back");
  const offOpen = search.on("enter", () => show(true));
  const offClose = search.on("exit", () => show(false));
  button.addEventListener("click", onClick);
  show(search.active);

  return () => {
    spring.destroy();
    offOpen();
    offClose();
    button.removeEventListener("click", onClick);
  };
}

// Opens and closes the search pill. The whole morph is one number, --search-t
// (0 = closed, 1 = open), set on the stage and driven by a spring; menu.css
// turns it into widths, so the look can change without touching this logic.
// The spring may overshoot 1 a little (that is the springy feel) but never
// goes below 0.
function wireSearch({
  stage,
  trigger,
  pill,
  input,
  clear,
  closePullDown,
  search,
}) {
  let target = 0;
  let restoreFocus = false;
  let openedByKeyboard = false;
  let enterByKeyboard = false;

  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Fully closed: tidy up the pill.
  function onRest(rested) {
    if (rested !== 0) return;
    stage.classList.remove("is-search-active");
    input.value = "";
    pill.classList.remove("has-text");
    if (restoreFocus) trigger.focus();
    restoreFocus = false;
  }

  const spring = createSpring({
    onUpdate: (v) => stage.style.setProperty("--search-t", v.toFixed(4)),
    onRest,
  });

  // Reverses from wherever it is, so rapid open/close never jumps or sticks.
  const run = () => spring.to(target, { instant: reducedMotion() });

  function open(byKeyboard) {
    if (target === 1) return;
    closePullDown();
    input.value = "";
    syncText();
    target = 1;
    restoreFocus = false;
    openedByKeyboard = byKeyboard;
    stage.classList.add("is-search-active");
    trigger.setAttribute("aria-expanded", "true");
    input.focus({ preventScroll: true });
    run();
  }

  // Focus only goes back to Search after Escape, and only if the pill was
  // opened from the keyboard: a mouse or touch user must never be left with a
  // focus ring on a pill button.
  function close(restore = false) {
    if (target === 0) return;
    target = 0;
    restoreFocus = restore && openedByKeyboard;
    trigger.setAttribute("aria-expanded", "false");
    run();
  }

  const syncText = () =>
    pill.classList.toggle("has-text", input.value.length > 0);

  // The field only reports what was typed (the state just records the query);
  // typing, clearing and clicking away never open or close anything.
  const onInput = () => {
    syncText();
    search.setQuery(input.value);
  };

  // Clicking Search starts search mode; this pill opens in response to the
  // state's "enter", like everything else that shows with it.
  const onTrigger = (event) => {
    enterByKeyboard = event.detail === 0;
    search.enter();
  };
  // Escape leaves search mode from anywhere, even when focus is elsewhere. An
  // open pull-down takes Escape first (it marks it handled).
  const onKeydown = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !search.active) {
      return;
    }
    event.preventDefault();
    search.exit("escape");
  };
  // Pressing on the pill's glass or the clear button must not pull focus off
  // the field.
  const onPillMousedown = (event) => {
    if (event.target !== input) event.preventDefault();
  };
  const onClear = () => {
    input.value = "";
    syncText();
    search.setQuery("");
    input.focus({ preventScroll: true });
  };

  const offEnter = search.on("enter", () => open(enterByKeyboard));
  // Back, Escape or browser back left search mode: discard the text, close.
  // Close first, then blur, so nothing reacts to the blur.
  const offExit = search.on("exit", ({ source }) => {
    input.value = "";
    syncText();
    close(source === "escape" || source === "back-key");
    if (pill.contains(document.activeElement)) document.activeElement.blur();
  });

  trigger.addEventListener("click", onTrigger);
  input.addEventListener("input", onInput);
  clear.addEventListener("click", onClear);
  document.addEventListener("keydown", onKeydown);
  pill.addEventListener("mousedown", onPillMousedown);
  return () => {
    spring.destroy();
    offEnter();
    offExit();
    trigger.removeEventListener("click", onTrigger);
    input.removeEventListener("input", onInput);
    clear.removeEventListener("click", onClear);
    document.removeEventListener("keydown", onKeydown);
    pill.removeEventListener("mousedown", onPillMousedown);
  };
}

const ACTIONS = {
  // Same sign-out as the lab, then back to the sign-in screen at /.
  async signOut() {
    await signOut();
    location.replace("/");
  },
};

function buildPanelItem(item) {
  const el = document.createElement(item.action ? "button" : "a");
  el.className = "menu-panel-item";
  el.setAttribute("role", "menuitem");
  if (item.destructive) el.classList.add("menu-panel-item-destructive");
  if (item.action) {
    el.type = "button";
    let busy = false;
    el.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      el.disabled = true;
      try {
        await ACTIONS[item.action]();
      } catch (err) {
        console.warn(`Menu action "${item.action}" failed.`, err);
        busy = false;
        el.disabled = false;
      }
    });
  } else {
    el.href = item.href;
  }
  el.innerHTML = `${iconSvg(item.icon)}<span class="menu-panel-label">${item.label}</span>`;
  return el;
}
let glass = null;
let teardown = null;

// A pull-down: opens from `trigger`, closes on outside click, Escape (focus
// returns to the trigger, and the event is marked handled so search mode
// doesn't also leave) or choosing an entry - unless `keepOpen`, for menus of
// toggles. `onOpen` runs just before it shows.
function wirePullDown(panel, trigger, { keepOpen = false, onOpen } = {}) {
  const entries = () =>
    [...panel.querySelectorAll('[role^="menuitem"]')].filter(
      (e) => !e.disabled,
    );
  const isOpen = () => panel.classList.contains("is-open");

  function setOpen(open) {
    if (open) onOpen?.();
    panel.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  }

  function onTrigger(event) {
    const opening = !isOpen();
    setOpen(opening);
    // Keyboard activation (detail 0) moves focus into the menu.
    if (opening && event.detail === 0) entries()[0]?.focus();
  }

  function onDocumentClick(event) {
    if (!isOpen()) return;
    // The click may have removed its own target (e.g. "See more" swaps the
    // list), so test the original path, not the live tree.
    const path = event.composedPath();
    if (path.includes(panel) || path.includes(trigger)) {
      // Choosing an entry closes the menu; the link still navigates.
      if (path.includes(panel) && !keepOpen) setOpen(false);
      return;
    }
    setOpen(false);
  }

  function onKeydown(event) {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = entries();
    if (!list.length) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const at = list.indexOf(document.activeElement);
    list[(at + step + list.length) % list.length].focus();
  }

  trigger.addEventListener("click", onTrigger);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
  return () => {
    trigger.removeEventListener("click", onTrigger);
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKeydown);
  };
}

export async function mountMenu({ search, filter }) {
  if (document.getElementById("app-menu-stage")) return;

  const nav = document.createElement("nav");
  nav.id = "app-menu";
  nav.className = "menu";
  nav.setAttribute("aria-label", "App menu");

  // The icon row: 44x44 buttons edge to edge.
  const row = document.createElement("div");
  row.className = "menu-row";
  row.append(...PILL_ITEMS.map(buildPillItem));
  nav.append(row);

  // Not inside the pill: liquidGL owns each lens's contents.
  const panel = document.createElement("div");
  panel.id = "app-menu-panel";
  panel.className = "menu-panel";
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "More");
  for (const item of MENU_ITEMS) {
    if (item.separatorBefore) {
      const line = document.createElement("div");
      line.className = "menu-panel-separator";
      line.setAttribute("role", "separator");
      panel.append(line);
    }
    panel.append(buildPanelItem(item));
  }

  const stage = document.createElement("div");
  stage.id = "app-menu-stage";
  stage.className = "menu-stage";
  // The bar keeps the search pill and the main pill side by side, right-aligned.
  const bar = document.createElement("div");
  bar.className = "menu-bar";
  const {
    pill: searchPill,
    input: searchInput,
    clear: searchClear,
  } = buildSearchPill();
  const {
    wrap: filterWrap,
    circle: filterCircle,
    button: filterButton,
    badge: filterBadge,
  } = buildFilterButton();
  const {
    panel: filterPanel,
    list: filterList,
    rows: filterRows,
    more: filterMore,
    clearAll: filterClearAll,
  } = buildFilterPanel();
  bar.append(filterWrap, searchPill, nav);
  const { circle: backCircle, button: backButton } = buildBackButton();
  stage.append(backCircle, bar, panel, filterPanel);
  document.body.append(stage);

  const trigger = row.querySelector('[data-opens="pull-down"]');
  const cleanups = [];
  if (trigger) cleanups.push(wirePullDown(panel, trigger));
  const filterWiring = wireFilter({
    circle: filterCircle,
    button: filterButton,
    badge: filterBadge,
    panel: filterPanel,
    list: filterList,
    rows: filterRows,
    more: filterMore,
    clearAll: filterClearAll,
    filter,
    search,
  });
  cleanups.push(
    wirePullDown(filterPanel, filterButton, {
      keepOpen: true,
      onOpen: () => {
        filterWiring.prepare();
        // The panel lines up under the filter circle's left edge.
        stage.style.setProperty(
          "--filter-left",
          `${filterCircle.getBoundingClientRect().left}px`,
        );
      },
    }),
    filterWiring.cleanup,
  );
  cleanups.push(
    wireBack({ stage, circle: backCircle, button: backButton, search }),
  );
  const searchTrigger = row.querySelector('[data-opens="search"]');
  if (searchTrigger) {
    cleanups.push(
      wireSearch({
        search,
        stage,
        trigger: searchTrigger,
        pill: searchPill,
        input: searchInput,
        clear: searchClear,
        closePullDown() {
          panel.classList.remove("is-open");
          trigger?.setAttribute("aria-expanded", "false");
        },
      }),
    );
  }
  teardown = () => cleanups.forEach((cleanup) => cleanup());

  try {
    const liquidGL = window.liquidGL ?? (await import(LIQUID_GL_URL)).default;
    if (HELPER) await loadScript(LIQUID_GL_HELPER_URL);
    // The menu may have been removed while the library was loading.
    if (!nav.isConnected) return;
    // Same shape as liquidGL's demos: one call per lens, content:false (the
    // children stay real DOM), zIndex so the search pill sits above the main
    // pill and the pull-down above both.
    glass = [
      liquidGL({
        ...GLASS_CONFIG,
        target: "#app-menu",
        content: false,
        zIndex: 1,
        helper: HELPER,
      }),
      liquidGL({
        ...GLASS_CONFIG,
        target: "#app-back",
        content: false,
        zIndex: 1,
      }),
      liquidGL({
        ...GLASS_CONFIG,
        target: "#app-search",
        content: false,
        zIndex: 2,
      }),
      liquidGL({
        ...GLASS_CONFIG,
        target: "#app-filter",
        content: false,
        zIndex: 2,
      }),
      liquidGL({
        ...GLASS_CONFIG,
        target: "#app-menu-panel",
        content: false,
        zIndex: 3,
      }),
      liquidGL({
        ...GLASS_CONFIG,
        target: "#app-filter-panel",
        content: false,
        zIndex: 3,
      }),
    ]
      .flat()
      .filter(Boolean);
    for (const lens of glass) fitBevel(lens);
  } catch (err) {
    console.warn("Liquid glass unavailable, using a plain pill.", err);
  }
}

// Keeps a lens's rim the same width in pixels as on the reference card, and
// re-measures when the lens changes size (the pull-down has no size until it
// first opens). liquidGL reads lens.options every frame.
function fitBevel(lens) {
  if (!lens?.el || !lens.options) return;
  const fit = () => {
    const { width, height } = lens.el.getBoundingClientRect();
    const side = Math.min(width, height);
    if (side <= 0) return;
    lens.options.bevelWidth = Math.min(
      0.5,
      (GLASS_CONFIG.bevelWidth * BEVEL_REFERENCE_PX) / side,
    );
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(lens.el);
  lens._fitBevelObserver = observer;
}

export function unmountMenu() {
  teardown?.();
  teardown = null;
  for (const lens of [glass].flat()) {
    lens?._fitBevelObserver?.disconnect();
    lens?.destroy?.();
  }
  glass = null;
  document.getElementById("app-menu-stage")?.remove();
}
