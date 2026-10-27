// The results page: renders what a search session (search-session.js) exposes,
// and nothing else. No searching, no filtering decisions - those live in the
// session. It shows a card grid, skeletons while waiting, a short message for
// "no results" / an error, and reveals the pool 20 cards at a time as the
// trailing skeletons scroll into view.
//
// Cards are reconciled by game id, so a card (and its cover image) survives
// the head-start draw, the final draw, narrowing and paging without being
// rebuilt.

import { refreshGlass } from "/js/glass-refresh.js";
import { TYPES } from "/js/result-types.js";
import { releaseYear } from "/js/ranking.js";

const PAGE_SIZE = 20;
const TRAILING = 12;
const TYPE_LABELS = new Map(TYPES.map((type) => [type.value, type.label]));

// IGDB serves covers at a size segment like t_1080p; the grid only needs
// t_cover_big_2x. PlayStation and SteamGridDB send no CORS headers, so
// liquidGL couldn't read them into its snapshot; they are shown through
// same-origin rewrites (vercel.json). Display only: stored URLs are unchanged.
const PROXIED_HOSTS = {
  "image.api.playstation.com": "/img/psn",
  "cdn2.steamgriddb.com": "/img/sgdb",
};

export function displayCoverUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "images.igdb.com") {
      return url.replace(/\/t_[a-z0-9_]+\//i, "/t_cover_big_2x/");
    }
    const prefix = PROXIED_HOSTS[parsed.hostname];
    if (prefix) {
      // Sony's image API resizes with ?w=; 528 matches IGDB's t_cover_big_2x.
      if (parsed.hostname === "image.api.playstation.com") {
        parsed.searchParams.set("w", "528");
      }
      return prefix + parsed.pathname + parsed.search;
    }
    return url;
  } catch {
    return url;
  }
}

// One warning per host whose cover only loaded without CORS: liquidGL can't read
// it, so it shows grey under the glass until vercel.json gets a rewrite for it.
const warnedHosts = new Set();
function warnNoCors(url) {
  let host = "";
  try {
    host = new URL(url, location.href).hostname;
  } catch {
    return;
  }
  if (!host || warnedHosts.has(host)) return;
  warnedHosts.add(host);
  console.warn(
    `Cover host ${host} sends no CORS headers: add a same-origin /img rewrite for it in vercel.json, or it shows grey under the glass.`,
  );
}

// Image loads can arrive in a burst; ask liquidGL to retake its snapshot once
// the burst settles rather than per image.
let glassTimer = null;
function refreshGlassSoon() {
  if (glassTimer) return;
  glassTimer = setTimeout(() => {
    glassTimer = null;
    refreshGlass();
  }, 120);
}

// Puts a cover into a tile. liquidGL snapshots the page, so images ask for CORS
// (crossOrigin) and set src last; hosts that send no CORS headers fail that
// way, so one retry without it. Nothing usable leaves the plain dark tile.
function setCover(card, art, url) {
  const wanted = displayCoverUrl(url);
  const current = art.querySelector("img");
  if (current && current.dataset.src === wanted) return;
  current?.remove();
  card.classList.remove("is-cover-loading");
  card.classList.toggle("is-no-cover", !wanted);
  if (!wanted) return;

  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.dataset.src = wanted;
  card.classList.add("is-cover-loading");

  let retried = false;
  img.addEventListener("load", () => {
    if (retried) warnNoCors(wanted);
    card.classList.remove("is-cover-loading");
    refreshGlassSoon();
  });
  img.addEventListener("error", () => {
    if (!retried && img.crossOrigin) {
      retried = true;
      img.removeAttribute("crossorigin");
      img.src = wanted;
      return;
    }
    img.remove();
    card.classList.remove("is-cover-loading");
    card.classList.add("is-no-cover");
  });
  img.crossOrigin = "anonymous";
  art.append(img);
  img.src = wanted;
}

function cardText(game) {
  const type = TYPE_LABELS.get(game.game_type);
  const year = releaseYear(game);
  return {
    title: game.name ?? "",
    meta: [type, year].filter(Boolean).join(" · "),
  };
}

// One card: a cover tile, then title, then "type · year". Tapping does nothing
// yet; the card just carries its game id.
export function renderCard(game) {
  const card = document.createElement("li");
  card.className = "result-card";
  card.dataset.id = String(game.id);

  const art = document.createElement("div");
  art.className = "result-cover";
  const name = document.createElement("p");
  name.className = "result-title";
  const meta = document.createElement("p");
  meta.className = "result-meta";
  card.append(art, name, meta);
  updateCard(card, game);
  return card;
}

function updateCard(card, game) {
  const { title, meta } = cardText(game);
  const [art, name, metaLine] = card.children;
  if (name.textContent !== title) name.textContent = title;
  if (metaLine.textContent !== meta) metaLine.textContent = meta;
  setCover(card, art, game.cover?.url);
}

// A skeleton card: same grid cell and shape as a real card, quiet shimmer.
export function renderSkeletonCard() {
  const card = document.createElement("li");
  card.className = "result-card is-skeleton";
  card.setAttribute("aria-hidden", "true");
  const art = document.createElement("div");
  art.className = "result-cover";
  const name = document.createElement("p");
  name.className = "result-title";
  const meta = document.createElement("p");
  meta.className = "result-meta";
  card.append(art, name, meta);
  return card;
}

// Makes the list hold exactly these games, in this order, followed by `pending`
// skeletons. Cards already there (matched by id) are moved, not rebuilt.
export function syncCards(list, games, pending = 0) {
  const existing = new Map();
  const skeletons = [];
  for (const node of [...list.children]) {
    if (node.dataset.id) existing.set(node.dataset.id, node);
    else skeletons.push(node);
  }

  let previous = null;
  for (const game of games) {
    const id = String(game.id);
    let node = existing.get(id);
    if (node) {
      existing.delete(id);
      updateCard(node, game);
    } else {
      node = renderCard(game);
    }
    const target = previous ? previous.nextSibling : list.firstChild;
    if (node !== target) list.insertBefore(node, target);
    previous = node;
  }
  for (const node of existing.values()) node.remove();

  // Skeletons already on screen stay as the same nodes so their shimmer never
  // restarts; only the difference is added or removed.
  for (const node of skeletons.splice(pending)) node.remove();
  for (const node of skeletons) {
    if (node.previousSibling !== previous)
      list.insertBefore(
        node,
        previous ? previous.nextSibling : list.firstChild,
      );
    previous = node;
  }
  for (let i = skeletons.length; i < pending; i++) {
    const node = renderSkeletonCard();
    list.append(node);
    syncShimmer(node);
  }
  list.toggleAttribute("aria-busy", pending > 0);
}

// Every shimmer shares one clock, so skeletons added later join in phase
// instead of starting their sweep from the beginning.
function syncShimmer(node) {
  if (typeof node.getAnimations !== "function") return;
  for (const animation of node.getAnimations({ subtree: true })) {
    animation.startTime = 0;
  }
}
// `session` is a search session (see search-session.js): { status, visible,
// generation, on("change") }. Nothing here knows how results are found.
export function createResultsPage(session) {
  const element = document.createElement("section");
  element.className = "results";
  element.setAttribute("aria-label", "Results");

  const list = document.createElement("ul");
  list.className = "results-grid";
  const message = document.createElement("p");
  message.className = "results-message";
  message.hidden = true;
  const note = document.createElement("p");
  note.className = "results-note";
  note.hidden = true;
  note.textContent = "IGDB search failed";
  element.append(list, message, note);

  let revealed = PAGE_SIZE;
  let generation = session.generation;
  let observer = null;

  function observeTrailing() {
    const first = list.querySelector(".is-skeleton");
    if (!first || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        revealed += PAGE_SIZE;
        render();
      },
      { rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(first);
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = false;
  }

  function render() {
    observer?.disconnect();
    observer = null;
    message.hidden = true;
    note.hidden = true;

    if (session.generation !== generation) {
      generation = session.generation;
      revealed = PAGE_SIZE;
      window.scrollTo(0, 0);
    }

    const { status } = session;
    const visible = session.visible;
    const shown = visible.slice(0, revealed);

    if (status === "blank") {
      syncCards(list, []);
    } else if (status === "loading") {
      syncCards(list, [], TRAILING);
    } else if (status === "error") {
      syncCards(list, []);
      showMessage("Couldn't search. Try again.");
    } else if (status === "partial") {
      // The real answer is still coming: the rest of the grid is skeletons.
      syncCards(list, shown, TRAILING);
    } else if (!visible.length) {
      syncCards(list, []);
      showMessage("No results");
    } else {
      const remaining = visible.length - shown.length;
      syncCards(list, shown, Math.min(TRAILING, remaining));
      observeTrailing();
      note.hidden = !session.failed;
    }
    refreshGlass();
  }

  const off = session.on("change", render);
  render();

  return {
    element,
    destroy: () => {
      observer?.disconnect();
      off();
    },
  };
}
