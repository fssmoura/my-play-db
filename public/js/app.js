import {
  getSession,
  onAuthChange,
  signInWithGoogle,
  signOut,
  readAuthErrorFromUrl,
} from "./session.js";
import * as connections from "./views/connections.js";
import * as search from "./views/search.js";
import * as apiConsole from "./views/console.js";

// Tab id -> view module. Sections are `#view-<id>` in index.html, and the tab
// order comes from the buttons there, not from this map.
const VIEWS = {
  connections,
  console: apiConsole,
  search,
};

const el = {
  loading: document.getElementById("loading"),
  gate: document.getElementById("gate"),
  gateError: document.getElementById("gate-error"),
  app: document.getElementById("app"),
  userEmail: document.getElementById("user-email"),
};

let mountedViews = false;

function show(which) {
  el.loading.classList.toggle("hidden", which !== "loading");
  el.gate.classList.toggle("hidden", which !== "gate");
  el.app.classList.toggle("hidden", which !== "app");
}

async function applySession(session) {
  if (!session) {
    mountedViews = false;
    show("gate");
    return;
  }

  el.userEmail.textContent = session.user.email ?? "";
  show("app");

  if (!mountedViews) {
    mountedViews = true;

    // Landing on a shared or refreshed search URL should show that search.
    // Selected *before* mounting, because the search view's own restore does a
    // network round trip and the wrong tab must not be visible meanwhile.
    if (new URLSearchParams(location.search).has("q")) selectTab("search");

    for (const [id, view] of Object.entries(VIEWS)) {
      await view.mount(document.getElementById(`view-${id}`));
    }
  }
}

function selectTab(view) {
  document.querySelector(`nav.tabs button[data-view="${view}"]`)?.click();
}

function wireTabs() {
  const buttons = document.querySelectorAll("nav.tabs button");
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
    });
  });
}

async function boot() {
  wireTabs();

  const authError = readAuthErrorFromUrl();
  if (authError) el.gateError.textContent = authError;

  document.getElementById("sign-in").addEventListener("click", async () => {
    el.gateError.textContent = "";
    try {
      await signInWithGoogle();
    } catch (err) {
      el.gateError.textContent = err.message;
    }
  });

  document.getElementById("sign-out").addEventListener("click", async () => {
    await signOut();
  });

  // onAuthStateChange also fires for the initial session and for token
  // refreshes, so it is the single source of truth after boot.
  onAuthChange(applySession);

  try {
    await applySession(await getSession());
  } catch (err) {
    el.gateError.textContent = err.message;
    show("gate");
  }
}

boot();
