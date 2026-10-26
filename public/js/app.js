import {
  getSession,
  onAuthChange,
  signInWithGoogle,
  signOut,
  signInWithPassword,
  readAuthErrorFromUrl,
} from "./session.js";
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

const ICON_EYE =
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />';
const ICON_EYE_OFF =
  '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5.5 19 2 12 2 12a18 18 0 0 1 4.1-5.1M9.9 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />';

async function boot() {
  wireTabs();

  // One view asking to open another (search result -> game page). The view
  // itself updates the URL; this only brings the right tab to the front.
  onNavigate((view) => selectTab(view));

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

  const passwordInput = document.getElementById("auth-password");
  const passwordToggle = document.getElementById("password-toggle");
  passwordToggle.addEventListener("click", () => {
    const reveal = passwordInput.type === "password";
    passwordInput.type = reveal ? "text" : "password";
    passwordToggle.querySelector("svg").innerHTML = reveal
      ? ICON_EYE_OFF
      : ICON_EYE;
    passwordToggle.setAttribute(
      "aria-label",
      reveal ? "Hide password" : "Show password",
    );
  });

  document
    .getElementById("password-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      el.gateError.textContent = "";
      try {
        await signInWithPassword(
          document.getElementById("auth-email").value,
          passwordInput.value,
        );
        passwordInput.value = "";
      } catch (err) {
        el.gateError.textContent = err.message;
      }
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
