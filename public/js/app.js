import {
  getSession,
  onAuthChange,
  signInWithGoogle,
  signOut,
  readAuthErrorFromUrl,
} from "./session.js";
import * as connections from "./views/connections.js";
import * as apiConsole from "./views/console.js";

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
    await connections.mount(document.getElementById("view-connections"));
    await apiConsole.mount(document.getElementById("view-console"));
  }
}

function wireTabs() {
  const buttons = document.querySelectorAll("nav.tabs button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) =>
        b.setAttribute("aria-selected", String(b === btn)),
      );
      document
        .getElementById("view-connections")
        .classList.toggle("hidden", btn.dataset.view !== "connections");
      document
        .getElementById("view-console")
        .classList.toggle("hidden", btn.dataset.view !== "console");
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
