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
import {
  displayImageUrl,
  loadImageForGlass,
  preloadImage,
} from "/js/image-url.js";

async function warmGameArt(id) {
  try {
    const { resolveGameArt } = await import("/js/game-art.js");
    const { banner, logo } = await resolveGameArt(id);
    preloadImage(banner, "banner");
    preloadImage(logo, "logo");
  } catch {
    // Only a head start; the game page does the real work.
  }
}

const PAGE_SIZE = 20;
const TRAILING = 12;
const TYPE_LABELS = new Map(TYPES.map((type) => [type.value, type.label]));

export const displayCoverUrl = (url) => displayImageUrl(url, "cover");

// Image loads can arrive in a burst; ask liquidGL to retake its snapshot once
// the burst settles rather than per image. A snapshot is expensive, so none is
// taken while the popular cards are sliding in (glassHoldUntil).
let glassTimer = null;
let glassHoldUntil = 0;
function refreshGlassSoon() {
  if (glassTimer) return;
  const wait = Math.max(120, glassHoldUntil - performance.now());
  glassTimer = setTimeout(() => {
    glassTimer = null;
    refreshGlass();
  }, wait);
}

// The popular cards' entrance (pages.css, placeholder-enter): each card starts
// ENTER_STAGGER_MS after the one before, up to ENTER_STAGGER_CARDS of them.
const ENTER_MS = 450;
const ENTER_STAGGER_MS = 35;
const ENTER_STAGGER_CARDS = 15;

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

  loadImageForGlass(img, wanted, {
    onLoad() {
      card.classList.remove("is-cover-loading");
      refreshGlassSoon();
    },
    onError() {
      img.remove();
      card.classList.remove("is-cover-loading");
      card.classList.add("is-no-cover");
    },
  });
  // Already in memory (preloaded): no shimmer, not even for the frame before
  // the load event arrives.
  if (img.complete && img.naturalWidth > 0) {
    card.classList.remove("is-cover-loading");
  }
  art.append(img);
}

function cardText(game) {
  const type = TYPE_LABELS.get(game.game_type);
  const year = releaseYear(game);
  return {
    title: game.name ?? "",
    meta: [type, year].filter(Boolean).join(" · "),
  };
}

// One card: a cover tile, then title, then "type · year", and an invisible
// button over the whole card that opens the game page (a real button, so Tab,
// Enter and Space work). The card carries its game id.
export function renderCard(game, owned = false) {
  const card = document.createElement("li");
  card.className = "result-card";
  card.dataset.id = String(game.id);

  const art = document.createElement("div");
  art.className = "result-cover";
  const name = document.createElement("p");
  name.className = "result-title";
  // The text sits in its own span so a long title can scroll (titleMarquee).
  name.append(document.createElement("span"));
  const meta = document.createElement("p");
  meta.className = "result-meta";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "result-open";
  card.append(art, name, meta, open);
  updateCard(card, game, owned);
  return card;
}

const OWNED_PILL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.965 8.521Q20 8.26 20 8c0-2.379-2.143-4.288-4.521-3.965C14.786 2.802 13.466 2 12 2s-2.786.802-3.479 2.035C6.138 3.712 4 5.621 4 8q0 .26.035.521C2.802 9.215 2 10.535 2 12s.802 2.785 2.035 3.479A4 4 0 0 0 4 16c0 2.379 2.138 4.283 4.521 3.965C9.214 21.198 10.534 22 12 22s2.786-.802 3.479-2.035C17.857 20.283 20 18.379 20 16q0-.26-.035-.521C21.198 14.785 22 13.465 22 12s-.802-2.785-2.035-3.479m-9.01 7.895l-3.667-3.714l1.424-1.404l2.257 2.286l4.327-4.294l1.408 1.42z" /></svg>In Library`;

// The "In Library" pill, bottom left inside the cover, on games the owner has.
function setOwned(art, owned) {
  const pill = art.querySelector(".result-owned");
  if (owned && !pill) {
    const span = document.createElement("span");
    span.className = "result-owned";
    span.innerHTML = OWNED_PILL;
    art.prepend(span);
  } else if (!owned && pill) {
    pill.remove();
  }
}

function updateCard(card, game, owned) {
  const { title, meta } = cardText(game);
  const [art, name, metaLine, open] = card.children;
  const label = owned ? `${title}, in library` : title;
  if (open.getAttribute("aria-label") !== label) {
    open.setAttribute("aria-label", label);
  }
  const text = name.firstElementChild;
  if (text.textContent !== title) text.textContent = title;
  if (metaLine.textContent !== meta) metaLine.textContent = meta;
  setCover(card, art, game.cover?.url);
  setOwned(art, owned);
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
// `isOwned(id)` says which get the In Library pill.
export function syncCards(list, games, pending = 0, isOwned = () => false) {
  const existing = new Map();
  const skeletons = [];
  for (const node of [...list.children]) {
    if (node.dataset.id) existing.set(node.dataset.id, node);
    else skeletons.push(node);
  }

  let previous = null;
  let index = 0;
  for (const game of games) {
    const id = String(game.id);
    let node = existing.get(id);
    if (node) {
      existing.delete(id);
      updateCard(node, game, isOwned(game.id));
    } else {
      node = renderCard(game, isOwned(game.id));
    }
    // Position in the list, for the staggered entrance.
    const i = String(Math.min(index++, ENTER_STAGGER_CARDS));
    if (node.style.getPropertyValue("--i") !== i) node.style.setProperty("--i", i);
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
// A cut-off title, hovered with a mouse: after a short wait it scrolls to its
// end, rests, fades, and starts over from the beginning. Leaving fades it back
// to where it started. Off under reduced motion, and on touch (no hover).
const MARQUEE = {
  waitMs: 700, // before each scroll
  pxPerSecond: 22,
  minScrollMs: 1600, // so a few pixels still glide rather than jump
  restMs: 1400, // at the end
  fadeMs: 300,
  // Sine in-out: starts and stops gently.
  easing: "cubic-bezier(0.37, 0, 0.63, 1)",
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function titleMarquee(list) {
  const running = new Map(); // title element -> its animation

  function start(title) {
    const text = title.firstElementChild;
    const overflow = title.scrollWidth - title.clientWidth;
    if (overflow <= 1 || running.has(title)) return;
    const scroll = Math.max(
      MARQUEE.minScrollMs,
      (overflow / MARQUEE.pxPerSecond) * 1000,
    );
    const { waitMs, restMs, fadeMs } = MARQUEE;
    const total = waitMs + scroll + restMs + fadeMs * 2;
    const at = (ms) => ms / total;
    const end = `translateX(${-overflow}px)`;
    title.classList.add("is-scrolling");
    running.set(
      title,
      text.animate(
        [
          { offset: 0, transform: "translateX(0)", opacity: 1 },
          { offset: at(waitMs), transform: "translateX(0)", opacity: 1, easing: MARQUEE.easing },
          { offset: at(waitMs + scroll), transform: end, opacity: 1 },
          { offset: at(waitMs + scroll + restMs), transform: end, opacity: 1 },
          { offset: at(waitMs + scroll + restMs + fadeMs), transform: end, opacity: 0 },
          { offset: at(waitMs + scroll + restMs + fadeMs), transform: "translateX(0)", opacity: 0 },
          { offset: 1, transform: "translateX(0)", opacity: 1 },
        ],
        { duration: total, iterations: Infinity },
      ),
    );
  }

  function stop(title) {
    const scrolling = running.get(title);
    if (!scrolling) return;
    running.delete(title);
    scrolling.pause();
    const text = title.firstElementChild;
    const fadeOut = text.animate([{ opacity: getComputedStyle(text).opacity }, { opacity: 0 }], {
      duration: MARQUEE.fadeMs,
      fill: "forwards",
    });
    fadeOut.onfinish = () => {
      // Hovered again meanwhile: that run owns the title now.
      if (running.has(title)) return fadeOut.cancel();
      scrolling.cancel();
      title.classList.remove("is-scrolling");
      fadeOut.cancel();
      text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MARQUEE.fadeMs });
    };
  }

  const titleOf = (event) =>
    event.target.matches?.(".result-card[data-id]")
      ? event.target.querySelector(".result-title")
      : null;
  const onEnter = (event) => {
    if (event.pointerType === "touch" || reducedMotion.matches) return;
    const title = titleOf(event);
    if (title) start(title);
  };
  const onLeave = (event) => {
    const title = titleOf(event);
    if (title) stop(title);
  };
  // Enter/leave don't bubble; a capturing listener still sees each card's.
  list.addEventListener("pointerenter", onEnter, true);
  list.addEventListener("pointerleave", onLeave, true);
  return () => {
    list.removeEventListener("pointerenter", onEnter, true);
    list.removeEventListener("pointerleave", onLeave, true);
    for (const scrolling of running.values()) scrolling.cancel();
  };
}

// `session` is a search session (see search-session.js): { status, visible,
// generation, on("change") }. Nothing here knows how results are found.
export function createResultsPage(session, { onOpen, isOwned } = {}) {
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
    const entering =
      session.placeholder === true && !list.classList.contains("is-placeholder");
    list.classList.toggle("is-placeholder", session.placeholder === true);
    if (entering) {
      glassHoldUntil =
        performance.now() + ENTER_MS + ENTER_STAGGER_MS * ENTER_STAGGER_CARDS;
    }

    if (status === "blank") {
      syncCards(list, []);
    } else if (status === "loading") {
      syncCards(list, [], TRAILING);
    } else if (status === "error") {
      syncCards(list, []);
      showMessage("Couldn't search. Try again.");
    } else if (status === "partial") {
      // The real answer is still coming: the rest of the grid is skeletons.
      syncCards(list, shown, TRAILING, isOwned);
    } else if (!visible.length) {
      syncCards(list, []);
      showMessage("No results");
    } else {
      const remaining = visible.length - shown.length;
      syncCards(list, shown, Math.min(TRAILING, remaining), isOwned);
      observeTrailing();
      note.hidden = !session.failed;
    }
    if (performance.now() < glassHoldUntil) refreshGlassSoon();
    else refreshGlass();
  }

  const onClick = (event) => {
    const card = event.target.closest?.(".result-card[data-id]");
    if (card && event.target.closest(".result-open")) {
      onOpen?.(Number(card.dataset.id));
    }
  };
  list.addEventListener("click", onClick);

  // Pressing a card (mouse or pen) starts the game's art lookup and image
  // downloads before the click opens the page, which joins the same lookup.
  // Not on touch: there a press usually starts a scroll.
  const onPress = (event) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    const card = event.target.closest?.(".result-card[data-id]");
    if (card && event.target.closest(".result-open")) {
      warmGameArt(Number(card.dataset.id));
    }
  };
  list.addEventListener("pointerdown", onPress);
  const stopMarquee = titleMarquee(list);

  const off = session.on("change", render);
  render();

  return {
    element,
    destroy: () => {
      observer?.disconnect();
      stopMarquee();
      list.removeEventListener("click", onClick);
      list.removeEventListener("pointerdown", onPress);
      off();
    },
  };
}
