// Top-right app menu. Behaviour only - all looks live in /css/menu.css.
// To add a pill button, add one entry to PILL_ITEMS; to add a pull-down entry,
// add one to MENU_ITEMS.
//
// The glass is drawn by liquidGL (MIT, WebGPU -> WebGL -> CSS fallback), on
// both the pill and the pull-down. It is a patched copy in /vendor - see the
// note at the top of that file. If it fails to load, the menu still works,
// just without glass.

import { signOut } from "/js/session.js";

const LIQUID_GL_URL = "/vendor/liquidGL.js";
const LIQUID_GL_HELPER_URL =
  "https://cdn.jsdelivr.net/npm/liquid-gl@3.0.0/liquidGL-helper.js";

// Icons: viewBox plus inner markup. "fill" icons are solid, "stroke" icons
// are outlines whose weight is --icon-stroke in menu.css.
const ICONS = {
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

// Buttons in the pill, left to right. Profile does nothing yet.
const PILL_ITEMS = [
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
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
  }
  return button;
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

function wirePullDown(nav, panel, trigger) {
  const entries = () => [...panel.querySelectorAll('[role="menuitem"]')];
  const isOpen = () => panel.classList.contains("is-open");

  function setOpen(open) {
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
    if (panel.contains(event.target) || trigger.contains(event.target)) {
      // Choosing an entry closes the menu; the link still navigates.
      if (panel.contains(event.target)) setOpen(false);
      return;
    }
    setOpen(false);
  }

  function onKeydown(event) {
    if (!isOpen()) return;
    if (event.key === "Escape") {
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

export async function mountMenu() {
  if (document.getElementById("app-menu-stage")) return;

  const nav = document.createElement("nav");
  nav.id = "app-menu";
  nav.className = "menu";
  nav.setAttribute("aria-label", "App menu");

  // The icon row: two 44x44 buttons edge to edge.
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
  stage.append(nav, panel);
  document.body.append(stage);

  const trigger = row.querySelector('[data-opens="pull-down"]');
  if (trigger) teardown = wirePullDown(nav, panel, trigger);

  try {
    const liquidGL = window.liquidGL ?? (await import(LIQUID_GL_URL)).default;
    if (HELPER) await loadScript(LIQUID_GL_HELPER_URL);
    // The menu may have been removed while the library was loading.
    if (!nav.isConnected) return;
    // Same shape as liquidGL's demos: one call per lens, content:false (the
    // children stay real DOM), zIndex so the pull-down sits above the pill.
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
        target: "#app-menu-panel",
        content: false,
        zIndex: 2,
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
