// The Customize drawer: opened from the game page's bottom toolbar, it slides
// in from the right over everything (full width on phones). Behaviour only -
// the look lives in css/customize.css. menu.js builds its Back and Save
// circles (the same builder as the app's Back circle), makes the glass lenses
// and wires it.
//
// - The slide is one number, --customize-t on the layer (0 hidden, 1 open),
//   driven by a spring; Back, Escape, the dimmed page and closing the game
//   page close it.
// - The active tab sits on a glass pill that moves by left and width
//   (liquidGL follows a lens's box, never its transform).
// - Save does nothing yet, and the tabs have no content yet. A game with no
//   SteamGridDB match shows a card to link one by hand (sgdb-link.js).

import { createSpring } from "/js/spring.js";
import { refreshGlass } from "/js/glass-refresh.js";
import { loadGameRow } from "/js/games-cache.js";
import { releaseYear } from "/js/ranking.js";
import { TYPES } from "/js/result-types.js";
import { buildSgdbLink, wireSgdbLink } from "/js/sgdb-link.js";

export const CUSTOMIZE_TABS = [
  { id: "cover", label: "Poster" },
  { id: "banner", label: "Banner" },
  { id: "logo", label: "Logo" },
  { id: "preview", label: "Preview" },
];

const TYPE_LABELS = new Map(TYPES.map((t) => [t.value, t.label]));

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function buildCustomize(buildCircleButton) {
  const layer = document.createElement("div");
  layer.id = "app-customize";
  layer.className = "customize-layer";

  const scrim = document.createElement("div");
  scrim.className = "customize-scrim";

  const drawer = document.createElement("section");
  drawer.className = "customize-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "customize-title");

  const header = document.createElement("header");
  header.className = "customize-header";
  const back = buildCircleButton({
    id: "customize-back",
    className: "customize-circle",
    label: "Back",
    icon: "back",
  });
  const save = buildCircleButton({
    id: "customize-save",
    className: "customize-circle",
    label: "Save",
    icon: "confirm",
  });
  const heading = document.createElement("div");
  heading.className = "customize-heading";
  const title = document.createElement("h2");
  title.id = "customize-title";
  title.className = "customize-title";
  const meta = document.createElement("p");
  meta.className = "customize-meta";
  heading.append(title, meta);
  header.append(back.circle, heading, save.circle);

  const tabRow = document.createElement("div");
  tabRow.className = "customize-tabs";
  tabRow.setAttribute("role", "tablist");
  tabRow.setAttribute("aria-label", "Customize");
  const pill = document.createElement("div");
  pill.id = "customize-tab-pill";
  pill.className = "customize-tab-pill";
  const panel = document.createElement("div");
  panel.id = "customize-panel";
  panel.className = "customize-panel";
  panel.setAttribute("role", "tabpanel");
  const sgdbLink = buildSgdbLink();
  panel.append(sgdbLink.card);
  const tabs = CUSTOMIZE_TABS.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `customize-tab-${tab.id}`;
    button.className = "customize-tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    // The labels sit on the pill but are not inside it, so they are kept out
    // of liquidGL's snapshot, as a lens's own contents are; otherwise the
    // glass shows them blurred behind themselves.
    button.setAttribute("data-liquid-ignore", "");
    button.textContent = tab.label;
    return button;
  });
  tabRow.append(pill, ...tabs);

  drawer.append(header, panel, tabRow);
  layer.append(scrim, drawer);
  return {
    layer,
    scrim,
    back: back.button,
    title,
    meta,
    tabRow,
    tabs,
    pill,
    panel,
    sgdbLink,
  };
}

export function wireCustomize({
  layer,
  scrim,
  back,
  title,
  meta,
  tabRow,
  tabs,
  pill,
  panel,
  sgdbLink,
  game,
}) {
  const link = wireSgdbLink(sgdbLink);
  let isOpen = false;
  let returnFocus = null;
  let inerted = [];
  let active = 0;
  let headingToken = 0;

  const spring = createSpring({
    onUpdate: (v) => layer.style.setProperty("--customize-t", v.toFixed(4)),
    onRest: (target) => {
      if (target === 1) refreshGlass();
      else if (!isOpen) layer.classList.remove("is-open", "is-closing");
    },
  });

  // The pill springs from 0 to 1 between where it was and the tab it is
  // heading for, so a change of mind mid-way starts from where it is.
  let from = { x: 0, w: 0 };
  let to = { x: 0, w: 0 };
  let now = { x: 0, w: 0 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const pillSpring = createSpring({
    onUpdate: (v) => {
      now = { x: lerp(from.x, to.x, v), w: lerp(from.w, to.w, v) };
      pill.style.left = `${now.x}px`;
      pill.style.width = `${now.w}px`;
    },
  });
  function placePill(instant) {
    const tab = tabs[active];
    from = { ...now };
    to = { x: tab.offsetLeft, w: tab.offsetWidth };
    pillSpring.set(0);
    pillSpring.to(1, { instant: instant || reducedMotion() });
  }

  function selectTab(index, { instant = false, focus = false } = {}) {
    active = index;
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", tabs[index].id);
    if (focus) tabs[index].focus();
    placePill(instant);
  }

  // The heading, and the "no match" card when the lookup found nothing.
  function fillHeading(id) {
    const token = ++headingToken;
    title.textContent = "";
    meta.textContent = "";
    link.hide();
    loadGameRow(id)
      .then((row) => {
        if (token !== headingToken || !row) return;
        title.textContent = row.name ?? "";
        meta.textContent = [TYPE_LABELS.get(row.game_type), releaseYear(row)]
          .filter(Boolean)
          .join(" · ");
        if (row.sgdb_id === 0) link.show(row.id, row.name);
      })
      .catch(() => {});
  }

  // Everything behind the drawer is out of reach (keyboard and screen
  // readers). Elements already inert stay as they were.
  function setBackgroundInert(on) {
    if (on) {
      inerted = [...document.body.children].filter(
        (el) => el !== layer && !el.inert,
      );
      for (const el of inerted) el.inert = true;
    } else {
      for (const el of inerted) el.inert = false;
      inerted = [];
    }
  }

  // Focus only moves into the drawer, and back to the trigger on close, when
  // it was opened from the keyboard: a mouse or touch user must never be left
  // with a focus ring (as in the menu's search).
  function open({ byKeyboard = false } = {}) {
    if (isOpen || !game.isOpen) return;
    isOpen = true;
    returnFocus = byKeyboard ? document.activeElement : null;
    fillHeading(game.id);
    layer.classList.remove("is-closing");
    layer.classList.add("is-open");
    selectTab(0, { instant: true });
    setBackgroundInert(true);
    spring.to(1, { instant: reducedMotion() });
    if (byKeyboard) back.focus({ preventScroll: true });
  }

  function close({ instant = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    layer.classList.add("is-closing");
    setBackgroundInert(false);
    if (layer.contains(document.activeElement)) document.activeElement.blur();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    spring.to(0, { instant: instant || reducedMotion() });
  }

  const onBack = () => close();
  const onScrim = () => close();
  // Capture phase, so Escape closes the drawer before the menu's own Escape
  // (which would close the game page) sees it.
  const onKeydown = (event) => {
    if (!isOpen || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onTabClick = (event) => {
    const index = tabs.indexOf(event.target.closest(".customize-tab"));
    if (index >= 0 && index !== active) selectTab(index);
  };
  // Arrow keys move between tabs (the usual tablist pattern).
  const onTabKey = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    selectTab((active + step + tabs.length) % tabs.length, { focus: true });
  };
  const resize = new ResizeObserver(() => {
    if (isOpen) placePill(true);
  });

  back.addEventListener("click", onBack);
  scrim.addEventListener("click", onScrim);
  tabRow.addEventListener("click", onTabClick);
  tabRow.addEventListener("keydown", onTabKey);
  document.addEventListener("keydown", onKeydown, true);
  resize.observe(tabRow);
  const offGameClose = game.on("close", () => close({ instant: true }));

  return {
    open,
    close,
    cleanup() {
      close({ instant: true });
      spring.destroy();
      pillSpring.destroy();
      resize.disconnect();
      back.removeEventListener("click", onBack);
      scrim.removeEventListener("click", onScrim);
      tabRow.removeEventListener("click", onTabClick);
      tabRow.removeEventListener("keydown", onTabKey);
      document.removeEventListener("keydown", onKeydown, true);
      offGameClose();
      link.cleanup();
    },
  };
}
