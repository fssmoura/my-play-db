// The achievement pages (css/achievements.css), full screen over the game page
// like the Trailers and Images all-cards page: a back arrow top left with the
// game's name and progress beside it.
//
//   openAchievements({ igdbId, gameName, behind, opener })
//   closeAchievementLayers()  (the game page calls it when the game closes)
//
// A game with several trophy groups (base game, add-ons) opens on a card per
// group; one group goes straight to its list. A list has a Sort button top
// right; tapping a trophy opens its own page. Pages stack, each one back to
// the one under it. Data: achievements-data.js.

import { createOverlayScroll } from "/js/overlay-scroll.js";
import {
  loadGameAchievements,
  arrange,
  sortOptions,
  sortAvailable,
  rarityBand,
  pointsUnit,
  percent,
  groupTitle,
  summaryLine,
  TIERS,
  BANDS,
} from "/js/achievements-data.js";

const NS = "http://www.w3.org/2000/svg";
// The app's back arrow (the menu bar's), and the Trailers page's Close.
const BACK =
  '<path d="M19 11H7.14l3.63-4.36a1 1 0 1 0-1.54-1.28l-5 6a1 1 0 0 0-.09.15c0 .05 0 .08-.07.13A1 1 0 0 0 4 12a1 1 0 0 0 .07.36c0 .05 0 .08.07.13a1 1 0 0 0 .09.15l5 6A1 1 0 0 0 10 19a1 1 0 0 0 .64-.23a1 1 0 0 0 .13-1.41L7.14 13H19a1 1 0 0 0 0-2"/>';
const CLOSE =
  '<path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.29 6.3 1.42-1.42-6.3-6.29 6.3-6.3z"/>';
const SORT =
  '<path fill="currentColor" d="m18 22l1.414-1.414L23 24.172V4h2v20.172l3.586-3.586L30 22l-6 6zM2 6h14v2H2zm4 6h10v2H6zm4 6h6v2h-6z"/>';
const CHECK = '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>';
const LOCK =
  '<path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z"/>';
const UNLOCKED =
  '<path d="M12 2a5 5 0 0 0-5 5h2a3 3 0 0 1 6 0v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z"/>';
// Rarity as a pyramid of four steps, Ultra Rare at the top, Common at the
// base; the trophy's own band is lit.
const PYRAMID_STEPS = [
  "M12 2l2 4h-4z",
  "M9.5 7h5l2 4h-9z",
  "M7 12h10l2 4H5z",
  "M4.5 17h15l2 4h-19z",
];

function icon(markup, cls, viewBox = "0 0 24 24") {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("class", cls);
  svg.innerHTML = markup;
  return svg;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);
const isHidden = (item) => item.secret && !item.earned;

function earnedDate(iso, withTime) {
  const d = new Date(iso);
  const date = d.toLocaleDateString();
  return withTime
    ? `${date} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date;
}

// ---- the stack of pages -------------------------------------------------------

const stack = [];
// One sort for every list while the pages are open.
let sortKey = "default";

export function closeAchievementLayers() {
  while (stack.length) stack.at(-1).close();
}

function openLayer({ label, behind, opener, close = false }) {
  const layer = el("div", "media-grid-layer ach-layer");
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", label);
  layer.setAttribute("data-liquid-ignore", "");
  layer.tabIndex = -1;

  const bar = el("div", "media-grid-bar");
  const back = el("button", "media-grid-close");
  back.type = "button";
  back.setAttribute("aria-label", close ? "Close" : "Back");
  back.append(icon(close ? CLOSE : BACK, "media-grid-close-icon"));
  const text = el("div", "ach-bar-text");
  const title = el("h2", "media-grid-title");
  const sub = el("p", "ach-bar-sub");
  text.append(title, sub);
  bar.append(back, text);

  const scroller = el("div", "media-grid-scroll overlay-scroll-host");
  const content = el("div", "ach-page");
  scroller.append(content);
  layer.append(bar, scroller);
  document.body.append(layer);
  const indicator = createOverlayScroll({
    scroller,
    content,
    host: layer,
    top: 85,
    bottom: 12,
  });

  let menu = null;
  const onKey = (e) => {
    if (e.key !== "Escape" || stack.at(-1) !== page) return;
    e.preventDefault();
    e.stopPropagation();
    if (menu && !menu.hidden) menu.close();
    else page.close();
  };
  window.addEventListener("keydown", onKey, true);
  back.addEventListener("click", () => page.close());

  const page = {
    layer,
    content,
    open: true,
    setHeader(t, s) {
      title.textContent = t ?? "";
      sub.textContent = s ?? "";
      sub.hidden = !s;
    },
    // The Sort button and its menu, top right.
    addSort(items, onChange) {
      menu = sortMenu(layer, items, onChange);
      layer.classList.add("has-sort");
    },
    close() {
      if (!page.open) return;
      page.open = false;
      stack.splice(stack.indexOf(page), 1);
      window.removeEventListener("keydown", onKey, true);
      menu?.destroy();
      indicator.destroy();
      layer.remove();
      if (behind) behind.inert = false;
      opener?.focus({ preventScroll: true });
    },
  };
  stack.push(page);
  if (behind) behind.inert = true;
  layer.focus({ preventScroll: true });
  return page;
}

function sortMenu(layer, items, onChange) {
  const wrap = el("div", "mv-top-right");
  const button = el("button", "media-grid-close ach-sort-button");
  button.type = "button";
  button.setAttribute("aria-label", "Sort");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.append(icon(SORT, "media-grid-close-icon", "0 0 32 32"));
  const menu = el("div", "mv-menu ach-sort-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  wrap.append(button, menu);
  layer.append(wrap);

  function fill() {
    menu.replaceChildren(el("p", "mv-menu-label", "Sort by"));
    for (const option of sortOptions) {
      const item = el("button", "mv-menu-item");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(option.key === sortKey));
      item.disabled = !sortAvailable(items, option.key);
      const mark = icon(CHECK, "mv-menu-icon ach-sort-check");
      mark.style.visibility = option.key === sortKey ? "visible" : "hidden";
      item.append(el("span", "mv-menu-text", option.label), mark);
      item.addEventListener("click", () => {
        sortKey = option.key;
        close();
        onChange();
      });
      menu.append(item);
    }
  }
  function open() {
    fill();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector(".mv-menu-item:not(:disabled)")?.focus();
  }
  function close() {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  const outside = (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) close();
  };
  layer.addEventListener("pointerdown", outside);
  return {
    get hidden() {
      return menu.hidden;
    },
    close,
    destroy: () => layer.removeEventListener("pointerdown", outside),
  };
}

// ---- opening -------------------------------------------------------------------

// result: the game page's already-loaded lists, if it has them.
export async function openAchievements({
  igdbId,
  gameName,
  behind,
  opener,
  result: loaded = null,
}) {
  closeAchievementLayers();
  sortKey = "default";
  const page = openLayer({ label: "Achievements", behind, opener });
  page.setHeader(gameName, "Loading…");

  let result = loaded;
  if (!result)
    try {
      result = await loadGameAchievements(igdbId);
    } catch {
      if (!page.open) return;
      page.setHeader(gameName, "");
      page.content.append(
        el("p", "ach-message", "Couldn't load achievements."),
      );
      return;
    }
  if (!page.open) return;

  page.setHeader(gameName, summaryLine(result));
  const ctx = {
    gameName,
    prefixes: [gameName, result.groups.find((g) => g.base)?.name],
  };
  if (result.groups.length > 1) drawGroups(page, result.groups, ctx);
  else drawList(page, result.groups[0]?.items ?? [], ctx);
}

// ---- several groups: a card each ------------------------------------------------

function drawGroups(page, groups, ctx) {
  const list = el("div", "ach-group-list");
  for (const group of groups) {
    const name = groupTitle(group, ctx.prefixes);
    const done = group.items.filter((i) => i.earned).length;
    const total = group.items.length;
    const card = el("button", "ach-group-card");
    card.type = "button";

    const head = el("span", "ach-group-head");
    head.append(
      el("span", "ach-group-name", name),
      el("span", "ach-group-percent", percent(done, total)),
    );
    card.append(head);

    const counts = el("span", "ach-group-tiers");
    if (group.items.some((i) => i.tier))
      for (const tier of TIERS) {
        const n = group.items.filter((i) => i.tier === tier && i.earned).length;
        const t = el("span", "ach-group-tier");
        t.append(trophyImage(tier), el("span", "", String(n)));
        counts.append(t);
      }
    else counts.append(el("span", "ach-group-count", `${done}/${total}`));
    card.append(counts);

    const bar = el("span", "ach-progress");
    const fill = el("span", "ach-progress-fill");
    fill.style.width = percent(done, total);
    bar.append(fill);
    card.append(bar);

    card.addEventListener("click", () => {
      const sub = openLayer({ label: name, behind: page.layer, opener: card });
      sub.setHeader(
        ctx.gameName,
        `${name} · ${done}/${total} unlocked · ${percent(done, total)}`,
      );
      drawList(sub, group.items, ctx);
    });
    list.append(card);
  }
  page.content.replaceChildren(list);
}

// ---- a list ------------------------------------------------------------------------

function drawList(page, items, ctx) {
  if (!sortAvailable(items, sortKey)) sortKey = "default";
  const draw = () => {
    if (!sortAvailable(items, sortKey)) sortKey = "default";
    const sections = arrange(items, sortKey);
    page.content.replaceChildren(
      ...sections.map((s) => {
        const wrap = el("section", "ach-list-section");
        wrap.append(
          el(
            "h3",
            "ach-list-title",
            sortKey === "default" ? s.title : `${s.title}: ${s.items.length}`,
          ),
        );
        const list = el("div", "ach-list");
        for (const item of s.items)
          list.append(trophyRow(item, { ...ctx, behind: page.layer }));
        wrap.append(list);
        return wrap;
      }),
    );
    if (!items.length)
      page.content.append(el("p", "ach-message", "No achievements stored."));
  };
  page.addSort(items, draw);
  draw();
}

function trophyImage(tier, hidden = false) {
  const img = document.createElement("img");
  img.src = hidden ? "/trophies/hidden.png" : `/trophies/${tier}.png`;
  img.alt = hidden ? "Hidden" : capitalise(tier);
  img.draggable = false;
  return img;
}

// The achievement's own picture, greyed while locked; a padlock when hidden
// or missing.
function picture(item, cls, reveal = false) {
  const box = el("span", cls);
  if ((isHidden(item) && !reveal) || !item.icon) {
    box.classList.add("is-placeholder");
    box.append(icon(LOCK, "ach-lock"));
    return box;
  }
  const img = document.createElement("img");
  img.src = item.icon;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  box.append(img);
  if (!item.earned) box.classList.add("is-locked");
  return box;
}

// The grade: a trophy (PlayStation, the dark one while hidden) or points.
function grade(item, reveal = false) {
  if (item.tier) return trophyImage(item.tier, isHidden(item) && !reveal);
  if (item.points != null)
    return el("span", "ach-points", `${item.points} ${pointsUnit(item)}`);
  return null;
}

function trophyRow(item, ctx) {
  const hidden = isHidden(item);
  const row = el("button", "ach-row");
  row.type = "button";
  row.classList.toggle("is-earned", item.earned);
  row.append(picture(item, "ach-row-img"));

  const body = el("span", "ach-row-body");
  body.append(
    el("span", "ach-row-name", hidden ? "Hidden" : item.name),
    el(
      "span",
      "ach-row-desc",
      hidden ? "Description is hidden." : (item.description ?? ""),
    ),
  );
  // Always present so every row is the same height: grade and rarity on the
  // left, when it was earned on the right.
  const foot = el("span", "ach-row-foot");
  const left = el("span", "ach-row-grade");
  const g = grade(item);
  if (g) left.append(g);
  if (item.rarity != null && !hidden)
    left.append(
      el(
        "span",
        "ach-row-rarity",
        `${rarityBand(item.rarity)} ${Number(item.rarity).toFixed(1)}%`,
      ),
    );
  foot.append(left);
  if (item.earned) {
    const when = el("span", "ach-row-earned");
    when.append(
      el("span", "", earnedDate(item.unlocked_at)),
      icon(UNLOCKED, "ach-row-unlocked"),
    );
    foot.append(when);
  }
  body.append(foot);
  row.append(body);

  row.addEventListener("click", () =>
    openTrophy(item, { ...ctx, opener: row }),
  );
  return row;
}

// ---- one trophy -----------------------------------------------------------------

function openTrophy(item, { gameName, behind, opener }) {
  const page = openLayer({
    label: isHidden(item) ? "Hidden trophy" : item.name,
    behind,
    opener,
    close: true,
  });
  page.setHeader("", "");
  page.layer.classList.add("is-trophy");
  // A column: the picture large on top, the value under it, its name last.
  const column = (art, value, label) => {
    const col = el("div", "ach-detail-col");
    const top = el("div", "ach-detail-art");
    top.append(art);
    col.append(
      top,
      el("p", "ach-detail-value", value),
      el("p", "ach-detail-label", label),
    );
    return col;
  };
  const draw = (reveal) => {
    const hidden = isHidden(item) && !reveal;
    const box = el("div", "ach-detail");
    box.append(picture(item, "ach-detail-img", reveal));
    box.append(
      el("p", "ach-detail-game", hidden ? "Hidden trophy" : gameName),
      el("h1", "ach-detail-name", hidden ? "Hidden" : item.name),
    );

    const cols = el("div", "ach-detail-cols");
    const g = grade(item, reveal);
    if (g)
      cols.append(
        column(
          g,
          item.tier ? (hidden ? "Hidden" : capitalise(item.tier)) : "Points",
          "Grade",
        ),
      );
    if (item.rarity != null) {
      const band = rarityBand(item.rarity);
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", "ach-pyramid");
      PYRAMID_STEPS.forEach((d, i) => {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        if (BANDS[i] === band) p.setAttribute("class", "is-lit");
        svg.append(p);
      });
      cols.append(
        column(svg, `${band} ${Number(item.rarity).toFixed(1)}%`, "Rarity"),
      );
    }
    if (cols.children.length) box.append(cols);

    const progress = el("div", "ach-detail-block");
    progress.append(el("p", "ach-detail-label", "Progress"));
    const state = el(
      "div",
      `ach-detail-progress${item.earned ? " is-earned" : ""}`,
    );
    if (item.earned)
      state.append(
        icon(CHECK, "ach-detail-icon"),
        el("span", "", `Earned ${earnedDate(item.unlocked_at, true)}`),
      );
    else state.append(el("span", "", "Not earned"));
    progress.append(state);
    box.append(progress);

    const details = el("div", "ach-detail-block");
    details.append(
      el("p", "ach-detail-label", "Details"),
      el(
        "p",
        "ach-detail-text",
        hidden ? "Hidden" : item.description || "No description.",
      ),
    );
    box.append(details);

    if (hidden) {
      const show = el("button", "ach-reveal", "Show Hidden Information");
      show.type = "button";
      show.addEventListener("click", () => {
        draw(true);
        page.layer.focus({ preventScroll: true });
      });
      box.append(show);
    }
    page.content.replaceChildren(box);
  };
  draw(false);
}
