import { getSession, onAuthChange, signOut } from "/js/session.js";
import * as connections from "./views/connections.js";
import * as search from "./views/search.js";
import * as game from "./views/game.js";
import * as media from "./views/media.js";
import * as apiConsole from "./views/console.js";
import { onNavigate } from "./navigate.js";

// Tab id -> view module. Sections are `#view-<id>` in index.html, and the tab
// order comes from the buttons there, not from this map.
const VIEWS = {
  connections,
  console: apiConsole,
  search,
  game,
  media,
};

const el = {
  loading: document.getElementById("loading"),
  app: document.getElementById("app"),
  userEmail: document.getElementById("user-email"),
};

let mountedViews = false;
let signingOut = false;

function show(which) {
  el.loading.classList.toggle("hidden", which !== "loading");
  el.app.classList.toggle("hidden", which !== "app");
}

// Sign-in belongs to the whole app and lives at `/`; it sends us back here.
function goToSignIn() {
  location.replace(
    "/?next=" + encodeURIComponent(location.pathname + location.search),
  );
}

async function applySession(session) {
  if (!session) {
    mountedViews = false;
    // Sign out redirects to "/" itself; don't race it with a `next` return.
    if (!signingOut) goToSignIn();
    return;
  }

  el.userEmail.textContent = session.user.email ?? "";
  show("app");

  if (!mountedViews) {
    mountedViews = true;

    // Landing on a shared or refreshed URL should show the tab it describes.
    // Selected *before* mounting, because those views restore themselves with
    // a network round trip and the wrong tab must not be visible meanwhile.
    // Most specific request wins.
    const params = new URLSearchParams(location.search);
    if (params.has("media")) selectTab("media");
    else if (params.has("game")) selectTab("game");
    else if (params.has("q")) selectTab("search");

    for (const [id, view] of Object.entries(VIEWS)) {
      await view.mount(document.getElementById(`view-${id}`));
    }
  }
}

function selectTab(view) {
  const button = document.querySelector(`nav.tabs button[data-view="${view}"]`);
  if (!button) return;
  // Media has no tab of its own until a game sends you there. Once it has, it
  // stays visible so you can step back into it.
  button.classList.remove("hidden");
  button.click();
}

function wireTabs() {
  const buttons = document.querySelectorAll("nav.tabs button");
  const mediaButton = document.querySelector(
    'nav.tabs button[data-view="media"]',
  );
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) =>
        b.setAttribute("aria-selected", String(b === btn)),
      );
      for (const id of Object.keys(VIEWS)) {
        document
          .getElementById(`view-${id}`)
          .classList.toggle("hidden", btn.dataset.view !== id);
      }
      // The media picker is a detour, not a destination: the moment you step
      // anywhere else, its tab closes behind you.
      if (btn.dataset.view !== "media") mediaButton?.classList.add("hidden");
    });
  });
}

async function boot() {
  wireTabs();

  // One view asking to open another (search result -> game page). The view
  // itself updates the URL; this only brings the right tab to the front.
  onNavigate((view) => selectTab(view));

  document.getElementById("sign-out").addEventListener("click", async () => {
    signingOut = true;
    await signOut();
    location.replace("/");
  });

  // onAuthStateChange also fires for the initial session and for token
  // refreshes, so it is the single source of truth after boot.
  onAuthChange(applySession);

  try {
    await applySession(await getSession());
  } catch {
    goToSignIn();
  }
}

boot();
