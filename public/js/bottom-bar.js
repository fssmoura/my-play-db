// The game page's floating bottom toolbar. Behaviour only - the look lives in
// css/menu.css (".menu-bottom"), and the glass lens is made by menu.js, which
// owns GLASS_CONFIG. To add a button, add one entry to BAR_ITEMS.
//
// - It shows only while the game page is open, rising and fading in with the
//   sheet (the game state's "progress" event, which follows the sheet's spring
//   and a finger's drag alike).
// - Two looks, one number: --bar-t on the stage, 1 expanded (icon + label),
//   0 compact (smaller icons only), animated with a spring.
// - Scrolling the page either way makes it compact. Per Apple's HIG (tab bars,
//   minimise on scroll) it comes back when someone taps it or scrolls to the
//   top - scrolling up alone does not bring it back.
// - Tapping while compact only expands it; the item is not triggered.
// - Every open of the sheet starts expanded.

import { createSpring } from "/js/spring.js";

// TODO: Customize does nothing yet.
export const BAR_ITEMS = [
  {
    id: "customize",
    label: "Customize",
    icon: "customize",
    onSelect() {},
  },
];

const EXPAND_ON_SCROLL_UP = false;
// Scrolled this far (px, either direction, cumulative) before it shrinks, so a
// twitch doesn't; and "at the top" tolerance.
const COMPACT_AFTER = 8;
const TOP_SLOP = 2;

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function buildBottomBar(items, iconSvg) {
  const bar = document.createElement("div");
  bar.id = "app-bottom";
  bar.className = "menu menu-bottom";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Game actions");
  bar.style.setProperty("--bar-n", String(items.length));
  const row = document.createElement("div");
  row.className = "menu-row menu-bottom-row";
  const buttons = items.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item menu-bottom-item";
    button.dataset.item = item.id;
    button.setAttribute("aria-label", item.label);
    button.innerHTML = `${iconSvg(item.icon)}<span class="menu-bottom-label">${item.label}</span>`;
    return button;
  });
  row.append(...buttons);
  bar.append(row);
  return { bar, buttons };
}

export function wireBottomBar({ stage, bar, items, buttons, game }) {
  let expanded = true;

  const spring = createSpring({
    onUpdate: (v) => stage.style.setProperty("--bar-t", v.toFixed(4)),
  });
  spring.set(1);

  function setExpanded(next) {
    if (expanded === next) return;
    expanded = next;
    bar.classList.toggle("is-compact", !next);
    spring.to(next ? 1 : 0, { instant: reducedMotion() });
  }

  let moved = 0;
  const offScroll = game.on("scroll", ({ top, delta }) => {
    if (top <= TOP_SLOP) {
      moved = 0;
      setExpanded(true);
    } else {
      moved += Math.abs(delta);
      if (moved > COMPACT_AFTER) setExpanded(false);
    }
  });

  const offProgress = game.on("progress", (v) => {
    const show = Math.min(Math.max(v, 0), 1);
    stage.style.setProperty("--bar-show", show.toFixed(4));
    stage.classList.toggle("is-bar-active", v > 0.001);
  });

  const offOpen = game.on("open", () => {
    moved = 0;
    expanded = true;
    bar.classList.remove("is-compact");
    spring.set(1);
  });

  // Capture phase: while compact, a tap only expands, whatever it hit.
  function onClickCapture(event) {
    if (expanded) return;
    event.stopPropagation();
    event.preventDefault();
    moved = 0;
    setExpanded(true);
  }
  bar.addEventListener("click", onClickCapture, true);
  buttons.forEach((button, i) =>
    button.addEventListener("click", () => items[i].onSelect?.()),
  );

  return () => {
    offScroll();
    offProgress();
    offOpen();
    bar.removeEventListener("click", onClickCapture, true);
    spring.destroy();
  };
}
