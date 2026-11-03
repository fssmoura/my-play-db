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
//   (liquidGL follows a lens's box, never its transform). The tabs float over
//   the content at the bottom, like the game page's toolbar.
// - Poster, Banner and Logo are image pickers (customize-picker.js), each
//   with its own saved size on the slider above the tabs. Preview
//   (customize-preview.js) shows the picks at full size and takes a URL by
//   hand.
// - Save moves to the next tab until Preview, where it writes each changed
//   kind - the pick always first, one other image kept behind it - closes
//   the drawer and has the game page reload its art. Nothing is written
//   before that: Back drops every unsaved pick.
// - Reset (red, beside Save) puts every pick back to the defaults an
//   untouched game gets; still only Save writes them.
// - A game with no SteamGridDB match shows a pop-up to link one by hand
//   (sgdb-link.js); closing it leaves the pickers empty.

import { createSpring } from "/js/spring.js";
import { refreshGlassWithin } from "/js/glass-refresh.js";
import { loadGameRow, setGameArtArray } from "/js/games-cache.js";
import { resolveGameArt, firstStaticArt, isIgdb } from "/js/game-art.js";
import { releaseYear } from "/js/ranking.js";
import { TYPES } from "/js/result-types.js";
import { buildSgdbLink, wireSgdbLink } from "/js/sgdb-link.js";
import { createPicker } from "/js/customize-picker.js";
import { createPreview } from "/js/customize-preview.js";

export const CUSTOMIZE_TABS = [
  { id: "cover", label: "Poster" },
  { id: "banner", label: "Banner" },
  { id: "logo", label: "Logo" },
  { id: "preview", label: "Preview" },
];
const KINDS = ["cover", "banner", "logo"];
const PREVIEW = CUSTOMIZE_TABS.length - 1;

// The slider picks images per row, one step at a time: left is more and
// smaller, right fewer and larger. Worked back from the largest banner, one
// per row. Each tab's step is kept in localStorage; the default is marked.
const ZOOM = {
  cover: { columns: [6, 5, 4, 3, 2], start: 2 },
  banner: { columns: [3, 2, 1], start: 1 },
  logo: { columns: [5, 4, 3, 2, 1], start: 2 },
};
const zoomKey = (kind) => `customize-zoom-v2-${kind}`;

function readZoom(kind) {
  const { columns, start } = ZOOM[kind];
  try {
    localStorage.removeItem(`customize-zoom-${kind}`);
    const raw = localStorage.getItem(zoomKey(kind));
    const value = Number(raw);
    if (raw !== null && Number.isInteger(value))
      return Math.min(Math.max(value, 0), columns.length - 1);
  } catch {
    // Storage blocked: the default it is.
  }
  return start;
}

function saveZoom(kind, value) {
  try {
    localStorage.setItem(zoomKey(kind), String(value));
  } catch {
    // Not kept; still works for this visit.
  }
}

const TYPE_LABELS = new Map(TYPES.map((t) => [t.value, t.label]));

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function buildCustomize(buildCircleButton, iconSvg) {
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
    label: "Next",
    icon: "next",
  });
  // Puts every pick back to the defaults (not saved until Save).
  const reset = buildCircleButton({
    id: "customize-reset",
    className: "customize-circle customize-reset",
    label: "Reset to Defaults",
    icon: "reset",
  });
  const heading = document.createElement("div");
  heading.className = "customize-heading";
  const title = document.createElement("h2");
  title.id = "customize-title";
  title.className = "customize-title";
  const meta = document.createElement("p");
  meta.className = "customize-meta";
  heading.append(title, meta);
  header.append(back.circle, heading, reset.circle, save.circle);
  // Close for the full-screen image viewer (customize-viewer.js).
  const viewerClose = buildCircleButton({
    id: "customize-viewer-close",
    className: "customize-circle",
    label: "Close",
    icon: "close",
  });

  // The size slider: smaller on the left, larger on the right.
  const zoom = document.createElement("div");
  zoom.className = "customize-zoom";
  // Each magnifier is also a button that moves the slider one step.
  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "customize-zoom-icon";
  zoomOut.setAttribute("aria-label", "Smaller images");
  zoomOut.innerHTML = iconSvg("zoomOut");
  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "customize-zoom-icon";
  zoomIn.setAttribute("aria-label", "Larger images");
  zoomIn.innerHTML = iconSvg("zoomIn");
  const range = document.createElement("input");
  range.type = "range";
  range.className = "customize-zoom-range";
  range.min = "0";
  range.step = "1";
  range.setAttribute("aria-label", "Image size");
  zoom.append(zoomOut, range, zoomIn);

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
  // Nothing in the panes ever sits under glass (they end above the tabs), so
  // liquidGL's photo skips them: hundreds of tiles made every photo slow.
  panel.setAttribute("data-liquid-ignore", "");
  const sgdbLink = buildSgdbLink();
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
  // The tabs float in a fixed box of their own above the drawer (as the game
  // page's toolbar has the menu stage); the drawer's content ends above them.
  const bar = document.createElement("div");
  bar.className = "customize-bar";
  bar.append(tabRow);

  // The slider sits at the bottom, just above the tabs.
  drawer.append(header, panel, zoom);
  // The "no match" pop-up covers the whole drawer, header and tabs included.
  layer.append(scrim, drawer, bar, sgdbLink.overlay);
  return {
    layer,
    drawer,
    bar,
    scrim,
    back: back.button,
    save: save.button,
    reset: reset.button,
    viewerClose,
    iconSvg,
    title,
    meta,
    zoom,
    range,
    tabRow,
    tabs,
    pill,
    panel,
    sgdbLink,
  };
}

export function wireCustomize({
  layer,
  drawer,
  bar,
  scrim,
  back,
  save,
  reset,
  viewerClose,
  iconSvg,
  title,
  meta,
  zoom,
  range,
  tabRow,
  tabs,
  pill,
  panel,
  sgdbLink,
  game,
}) {
  const link = wireSgdbLink(sgdbLink, { blocks: [drawer, bar] });
  let isOpen = false;
  let returnFocus = null;
  let inerted = [];
  let active = 0;
  let loadToken = 0;
  let saving = false;

  // This opening's game: the stored arrays, and what is picked (each
  // { url, width, height } or null). After Reset, `defaults` holds the whole
  // array each kind goes back to, backup included.
  let gameId = null;
  let sgdbId = null;
  let arrays = {};
  let picks = {};
  let defaults = null;

  const pickers = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      createPicker({ kind, onSelect: (item) => pick(kind, item) }),
    ]),
  );
  const preview = createPreview({
    onManual: (kind, p) => pick(kind, p),
    viewerClose,
  });
  panel.append(...KINDS.map((kind) => pickers[kind].element), preview.element);
  // Over the whole drawer; in the DOM from the start so its Close's glass
  // can be made with the others.
  layer.append(preview.viewerElement);

  function pick(kind, { url, width, height }) {
    picks[kind] = { url, width, height };
    pickers[kind].setSelected(url);
    preview.render(picks);
  }

  const spring = createSpring({
    onUpdate: (v) => layer.style.setProperty("--customize-t", v.toFixed(4)),
    onRest: (target) => {
      if (target === 1) refreshGlassWithin(layer);
      else if (!isOpen) {
        layer.classList.remove("is-open", "is-closing");
        // Nothing keeps loading behind a closed drawer.
        for (const kind of KINDS) pickers[kind].setWaiting();
      }
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

  function applyZoom(kind, step) {
    pickers[kind].element.style.setProperty(
      "--cols",
      String(ZOOM[kind].columns[step]),
    );
  }
  for (const kind of KINDS) applyZoom(kind, readZoom(kind));

  function showZoom(kind) {
    zoom.hidden = !kind;
    if (!kind) return;
    const step = readZoom(kind);
    const last = ZOOM[kind].columns.length - 1;
    range.max = String(last);
    range.value = String(step);
    range.style.setProperty("--fill", `${(step / last) * 100}%`);
  }

  // Save reads Next until the last tab.
  function setSaveIcon() {
    const last = active === PREVIEW;
    const label = last ? "Save" : "Next";
    save.innerHTML = iconSvg(last ? "confirm" : "next");
    save.title = label;
    save.setAttribute("aria-label", label);
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
    const kind = KINDS[index] ?? null;
    showZoom(kind);
    for (const k of KINDS) pickers[k].element.hidden = k !== kind;
    preview.element.hidden = index !== PREVIEW;
    if (kind) pickers[kind].activate();
    else preview.activate();
    setSaveIcon();
  }

  // The heading, the pickers' source and the stored picks. A game whose
  // lookup is still running (opened before the game page finished) waits
  // for it. No match: the link pop-up.
  async function loadGame(id) {
    const token = ++loadToken;
    title.textContent = "";
    meta.textContent = "";
    link.hide();
    gameId = id;
    sgdbId = null;
    arrays = {};
    picks = {};
    defaults = null;
    for (const kind of KINDS) pickers[kind].setWaiting();
    preview.reset();
    preview.render(picks);
    let row = null;
    try {
      row = await loadGameRow(id);
      if (row && row.sgdb_id == null) {
        await resolveGameArt(id);
        row = await loadGameRow(id);
      }
    } catch {
      row = null;
    }
    if (token !== loadToken) return;
    if (!row) {
      for (const kind of KINDS) pickers[kind].setSource(null);
      return;
    }
    title.textContent = row.name ?? "";
    meta.textContent = [TYPE_LABELS.get(row.game_type), releaseYear(row)]
      .filter(Boolean)
      .join(" · ");
    for (const kind of KINDS) {
      arrays[kind] = row[kind] ?? null;
      const url = arrays[kind]?.[0] ?? null;
      picks[kind] = url ? { url } : null;
    }
    preview.render(picks);
    setSource(row.sgdb_id);
    if (row.sgdb_id === 0) {
      link.show(row.id, row.name, {
        onLinked: (id) => token === loadToken && setSource(id),
      });
    }
  }

  function setSource(id) {
    sgdbId = id > 0 ? id : null;
    for (const kind of KINDS) {
      pickers[kind].setSource(id);
      pickers[kind].setSelected(picks[kind]?.url);
    }
    const kind = KINDS[active];
    if (kind) pickers[kind].activate();
  }

  // Reset: every kind back to what an untouched game gets - the IGDB poster
  // first with SteamGridDB's first static one behind it (or that one alone),
  // and SteamGridDB's first static banner and logo. Shown in Preview; only
  // Save writes it.
  async function resetAll() {
    if (gameId == null || saving) return;
    const token = loadToken;
    preview.setStatus("Loading defaults…");
    selectTab(PREVIEW);
    try {
      const firsts = await Promise.all(
        KINDS.map((kind) =>
          sgdbId ? firstStaticArt(sgdbId, kind) : Promise.resolve(null),
        ),
      );
      if (token !== loadToken) return;
      defaults = {};
      KINDS.forEach((kind, i) => {
        const igdb = arrays[kind]?.find(isIgdb) ?? null;
        const list = [igdb, firsts[i]].filter(Boolean);
        defaults[kind] = list.length ? list : null;
        const url = defaults[kind]?.[0] ?? null;
        picks[kind] = url ? { url } : null;
        pickers[kind].setSelected(url);
      });
      preview.render(picks);
      preview.setStatus("");
    } catch {
      if (token === loadToken)
        preview.setStatus("Couldn't load the defaults. Try again.");
    }
  }

  // What each kind's array becomes: the Reset array while its pick is still
  // the default, otherwise the pick first with one other image kept behind
  // it as the fallback (the IGDB one when there is one). Null: unchanged.
  function nextArray(kind) {
    const url = picks[kind]?.url ?? null;
    const now = arrays[kind] ?? null;
    let next;
    if (defaults && (defaults[kind]?.[0] ?? null) === url) {
      next = defaults[kind];
    } else {
      if (!url || url === now?.[0]) return undefined;
      const rest = (now ?? []).filter((x) => x !== url);
      const backup = isIgdb(url) ? rest[0] : (rest.find(isIgdb) ?? rest[0]);
      next = backup ? [url, backup] : [url];
    }
    const same = JSON.stringify(next ?? null) === JSON.stringify(now ?? null);
    return same ? undefined : next;
  }

  // Writes each kind that changed - what was picked goes first, always -
  // then closes and has the game page show the new art.
  async function saveAll() {
    if (saving || gameId == null) return;
    const changed = KINDS.map((kind) => [kind, nextArray(kind)]).filter(
      ([, next]) => next !== undefined,
    );
    if (!changed.length) return close();
    saving = true;
    const id = gameId;
    preview.setStatus("Saving…");
    try {
      for (const [kind, next] of changed) {
        await setGameArtArray(id, kind, next);
        arrays[kind] = next;
      }
      preview.setStatus("");
      game.reportArtChanged(id);
      close();
    } catch {
      preview.setStatus("Couldn't save. Try again.");
    } finally {
      saving = false;
    }
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
    layer.classList.remove("is-closing");
    layer.classList.add("is-open");
    selectTab(0, { instant: true });
    loadGame(game.id);
    setBackgroundInert(true);
    spring.to(1, { instant: reducedMotion() });
    if (byKeyboard) back.focus({ preventScroll: true });
  }

  function close({ instant = false } = {}) {
    if (!isOpen) return;
    preview.closeViewer();
    isOpen = false;
    loadToken += 1;
    link.hide();
    layer.classList.add("is-closing");
    setBackgroundInert(false);
    if (layer.contains(document.activeElement)) document.activeElement.blur();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    spring.to(0, { instant: instant || reducedMotion() });
  }

  const onBack = () => close();
  const onSave = () => {
    if (active < PREVIEW) selectTab(active + 1);
    else saveAll();
  };
  const onReset = () => resetAll();
  const onScrim = () => close();
  // Capture phase, so Escape closes the drawer before the menu's own Escape
  // (which would close the game page) sees it. In a URL field it closes the
  // field instead.
  const onKeydown = (event) => {
    if (!isOpen || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (preview.closeViewer()) return;
    if (!preview.cancelField(event.target)) close();
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
  const onZoom = () => {
    const kind = KINDS[active];
    if (!kind) return;
    const step = Number(range.value);
    const last = ZOOM[kind].columns.length - 1;
    range.style.setProperty("--fill", `${(step / last) * 100}%`);
    applyZoom(kind, step);
    saveZoom(kind, step);
    pickers[kind].relayout();
  };
  const onZoomStep = (event) => {
    const button = event.target.closest(".customize-zoom-icon");
    if (!button) return;
    const step = button === zoom.firstElementChild ? -1 : 1;
    const next = Number(range.value) + step;
    if (next < 0 || next > Number(range.max)) return;
    range.value = String(next);
    onZoom();
  };
  const resize = new ResizeObserver(() => {
    if (isOpen) placePill(true);
  });

  back.addEventListener("click", onBack);
  save.addEventListener("click", onSave);
  reset.addEventListener("click", onReset);
  scrim.addEventListener("click", onScrim);
  tabRow.addEventListener("click", onTabClick);
  tabRow.addEventListener("keydown", onTabKey);
  range.addEventListener("input", onZoom);
  zoom.addEventListener("click", onZoomStep);
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
      save.removeEventListener("click", onSave);
      reset.removeEventListener("click", onReset);
      scrim.removeEventListener("click", onScrim);
      tabRow.removeEventListener("click", onTabClick);
      tabRow.removeEventListener("keydown", onTabKey);
      range.removeEventListener("input", onZoom);
      zoom.removeEventListener("click", onZoomStep);
      document.removeEventListener("keydown", onKeydown, true);
      offGameClose();
      link.cleanup();
      for (const kind of KINDS) pickers[kind].destroy();
      preview.destroy();
    },
  };
}
