import {
  getSession,
  onAuthChange,
  signInWithGoogle,
  signInWithPassword,
  readAuthErrorFromUrl,
} from "/js/session.js";
import { mountMenu, unmountMenu } from "/js/menu.js";

const ICON_EYE =
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />';
const ICON_EYE_OFF =
  '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5.5 19 2 12 2 12a18 18 0 0 1 4.1-5.1M9.9 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const el = {
  loading: document.getElementById("loading"),
  gate: document.getElementById("gate"),
  gateError: document.getElementById("gate-error"),
  google: document.getElementById("sign-in"),
  submit: document.getElementById("submit"),
  email: document.getElementById("auth-email"),
  emailError: document.getElementById("email-error"),
  password: document.getElementById("auth-password"),
  toggle: document.getElementById("password-toggle"),
};

function show(which) {
  el.loading.classList.toggle("hidden", which !== "loading");
  el.gate.classList.toggle("hidden", which !== "gate");
}

// Only same-site paths: must start with "/" and not "//" (protocol-relative).
function nextPath() {
  const next = new URLSearchParams(location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return null;
}

function applySession(session) {
  if (!session) {
    unmountMenu();
    show("gate");
    return;
  }

  const next = nextPath();
  if (next) {
    location.replace(next);
    return;
  }
  // Signed in with nowhere to go: the new app is a blank canvas, plus the menu.
  show("none");
  mountMenu();
}

// Plain-language messages; never a bare "Error".
function friendlyError(err) {
  const message = String(err?.message ?? "");
  if (/invalid login credentials/i.test(message)) {
    return "Incorrect email or password.";
  }
  if (
    err?.name === "AuthRetryableFetchError" ||
    err instanceof TypeError ||
    /failed to fetch|network/i.test(message)
  ) {
    return "Can't connect. Check your connection and try again.";
  }
  return message || "Something went wrong. Try again.";
}

function setError(text) {
  el.gateError.textContent = text;
}

function validateEmail() {
  const value = el.email.value.trim();
  const bad = value !== "" && !EMAIL_PATTERN.test(value);
  el.emailError.textContent = bad ? "Enter a valid email address." : "";
  el.email.setAttribute("aria-invalid", String(bad));
  return !bad;
}

// Shows an in-button indicator with a specific label, and locks the form.
function setBusy(button, busyLabel) {
  const label = button.querySelector(".btn-label");
  const original = label.textContent;
  const locked = [el.google, el.submit, el.email, el.password, el.toggle];
  button.classList.add("is-busy");
  label.textContent = busyLabel;
  locked.forEach((node) => (node.disabled = true));
  return () => {
    button.classList.remove("is-busy");
    label.textContent = original;
    locked.forEach((node) => (node.disabled = false));
  };
}

function boot() {
  const authError = readAuthErrorFromUrl();
  if (authError) setError(authError);

  el.google.addEventListener("click", async () => {
    setError("");
    const done = setBusy(el.google, "Opening Google…");
    try {
      await signInWithGoogle(nextPath());
      // The page is about to leave for Google; keep the busy state.
    } catch (err) {
      done();
      setError(friendlyError(err));
    }
  });

  el.toggle.addEventListener("click", () => {
    const reveal = el.password.type === "password";
    el.password.type = reveal ? "text" : "password";
    el.toggle.querySelector("svg").innerHTML = reveal ? ICON_EYE_OFF : ICON_EYE;
    el.toggle.setAttribute(
      "aria-label",
      reveal ? "Hide password" : "Show password",
    );
    el.toggle.setAttribute("aria-pressed", String(reveal));
  });

  el.email.addEventListener("blur", validateEmail);
  el.email.addEventListener("input", () => {
    setError("");
    el.emailError.textContent = "";
    el.email.setAttribute("aria-invalid", "false");
  });
  el.password.addEventListener("input", () => setError(""));

  // Enter in either field submits the form natively.
  document
    .getElementById("password-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      setError("");
      if (!el.email.value.trim() || !el.password.value) {
        setError("Enter your email and password.");
        return;
      }
      if (!validateEmail()) return;

      const done = setBusy(el.submit, "Signing In…");
      try {
        await signInWithPassword(el.email.value.trim(), el.password.value);
        el.password.value = "";
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        done();
      }
    });

  // onAuthStateChange also fires for the initial session and for token
  // refreshes, so it is the single source of truth after boot.
  onAuthChange(applySession);

  getSession()
    .then(applySession)
    .catch((err) => {
      setError(friendlyError(err));
      show("gate");
    });
}

boot();
