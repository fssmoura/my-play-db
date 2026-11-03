// The "no SteamGridDB match" card in the Customize drawer. Shown when the
// game's lookup found nothing (sgdb_id 0): a search field pre-filled with the
// name the lookup used, SteamGridDB's results as "Name (year)", and picking
// one stores it as the game's sgdb_id for good, and the drawer then loads its
// images. Its close icon leaves it unlinked. The look is in css/customize.css.

import { setSgdbId } from "/js/games-cache.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";

const SEARCH_DELAY_MS = 350;

async function searchSgdb(name) {
  const { call } = await import("/js/api.js");
  return (await call("sgdb", "search", { name })) ?? [];
}

function resultLabel(result) {
  const year = result.release_date
    ? new Date(result.release_date * 1000).getUTCFullYear()
    : null;
  return year ? `${result.name} (${year})` : result.name;
}

export function buildSgdbLink() {
  const card = document.createElement("div");
  card.className = "sgdb-link";
  card.setAttribute("role", "group");
  card.setAttribute("aria-labelledby", "sgdb-link-title");

  const title = document.createElement("h3");
  title.id = "sgdb-link-title";
  title.className = "sgdb-link-title";
  title.textContent = "No SteamGridDB Match";

  const field = document.createElement("div");
  field.className = "field sgdb-link-field";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Game name";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search SteamGridDB");
  field.append(input);

  // The results box: the list scrolls inside it (with the app's overlay
  // indicator), and the status ("Searching…", "No results.") is its
  // placeholder, centred in the box while the list is empty.
  const results = document.createElement("div");
  results.className = "sgdb-link-results";
  const scroller = document.createElement("div");
  scroller.className = "sgdb-link-scroll overlay-scroll-host";
  const list = document.createElement("ul");
  list.className = "sgdb-link-list";
  scroller.append(list);
  const status = document.createElement("p");
  status.className = "sgdb-link-status";
  status.setAttribute("role", "status");
  results.append(scroller, status);

  // Title on the left, a plain close icon on the right that leaves the game
  // unlinked (the drawer stays usable without images).
  const head = document.createElement("div");
  head.className = "sgdb-link-head";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "sgdb-link-dismiss";
  dismiss.setAttribute("aria-label", "Close");
  dismiss.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.29 6.3 1.42-1.42-6.3-6.29 6.3-6.3z"/></svg>';
  head.append(title, dismiss);

  card.append(head, field, results);

  // The card floats over the drawer's content as a pop-up.
  const overlay = document.createElement("div");
  overlay.className = "sgdb-link-overlay";
  overlay.hidden = true;
  overlay.append(card);
  return { overlay, card, input, status, list, scroller, results, dismiss };
}

export function wireSgdbLink(
  { overlay: popup, card, input, status, list, scroller, results, dismiss },
  { blocks = [] } = {},
) {
  let gameId = null;
  let callbacks = {};
  let timer = 0;
  let token = 0;
  let saving = false;
  const overlay = createOverlayScroll({
    scroller,
    content: list,
    host: results,
    top: 6,
    bottom: 6,
  });

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function render(results) {
    scroller.scrollTop = 0;
    list.replaceChildren(
      ...results.map((result) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sgdb-link-result";
        button.dataset.sgdbId = result.id;
        button.textContent = resultLabel(result);
        item.append(button);
        return item;
      }),
    );
  }

  async function search(name) {
    const mine = ++token;
    const query = name.trim();
    if (!query) {
      render([]);
      setStatus("");
      return;
    }
    render([]);
    setStatus("Searching…");
    try {
      const results = (await searchSgdb(query)).filter((r) => r?.id != null);
      if (mine !== token) return;
      render(results);
      setStatus(results.length ? "" : "No results.");
    } catch {
      if (mine !== token) return;
      render([]);
      setStatus("Couldn't reach SteamGridDB. Try again.");
    }
  }

  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value), SEARCH_DELAY_MS);
  };
  const onEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(timer);
    search(input.value);
  };
  const onPick = async (event) => {
    const button = event.target.closest(".sgdb-link-result");
    if (!button || saving || gameId == null) return;
    saving = true;
    // The dimmed list shows it is linking; the placeholder only speaks when
    // the box is empty.
    card.classList.add("is-saving");
    try {
      const sgdbId = Number(button.dataset.sgdbId);
      await setSgdbId(gameId, sgdbId);
      const { onLinked } = callbacks;
      hide();
      onLinked?.(sgdbId);
    } catch {
      render([]);
      setStatus("Couldn't save the link. Search again to retry.");
    } finally {
      saving = false;
      card.classList.remove("is-saving");
    }
  };

  const onDismiss = () => hide();

  // onLinked(sgdbId) runs once a pick is stored. While it shows, everything
  // in `blocks` (the rest of the drawer) is out of reach.
  function show(id, name, { onLinked } = {}) {
    gameId = id;
    callbacks = { onLinked };
    input.value = name ?? "";
    render([]);
    popup.hidden = false;
    for (const el of blocks) el.inert = true;
    search(input.value);
  }

  function hide() {
    clearTimeout(timer);
    token += 1;
    gameId = null;
    callbacks = {};
    // Nothing stays focused inside a hidden pop-up (no stray ring).
    if (popup.contains(document.activeElement)) document.activeElement.blur();
    popup.hidden = true;
    for (const el of blocks) el.inert = false;
    render([]);
    setStatus("");
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onEnter);
  list.addEventListener("click", onPick);
  dismiss.addEventListener("click", onDismiss);

  return {
    show,
    hide,
    cleanup() {
      hide();
      overlay.destroy();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onEnter);
      list.removeEventListener("click", onPick);
      dismiss.removeEventListener("click", onDismiss);
    },
  };
}
