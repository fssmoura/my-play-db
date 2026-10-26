import { PLATFORMS, hasRefreshMaterial } from "../platforms.js";
import * as vault from "../vault.js";
import { call } from "../api.js";
import {
  openPopup,
  closePopup,
  steamOpenIdUrl,
  awaitSteamOpenId,
  awaitClipboardCredential,
  shouldUseRedirect,
  beginSteamRedirect,
  consumePendingRedirect,
} from "../connect.js";
import { refreshStale, startAutoRefresh, clearFailure } from "../refresh.js";

let records = {};
let root;
let stopAutoRefresh = null;
let stopLiveStatus = null;
const expanded = new Set();

// Survives a repaint. `render()` rebuilds the whole list, so the last message
// has to be held here or it would vanish on the next tick.
let statusMsg = { text: "", isError: false };

// How often the "40d left" countdowns are repainted. Purely local - reads the
// records already in memory and touches no network - so this is about keeping
// the screen honest, not about polling anything.
const TICK_MS = 30 * 1000;

export async function mount(el) {
  root = el;
  root.innerHTML = `<p class="meta">Loading...</p>`;
  await reload();

  // Finish a mobile redirect first - runs after the Supabase session is
  // restored, otherwise the verify call would 401.
  await resumeRedirect();

  await runAutoRefresh();
  stopAutoRefresh?.();
  stopAutoRefresh = startAutoRefresh(
    () => records,
    async (result) => await applyRefreshResult(result),
  );

  stopLiveStatus?.();
  stopLiveStatus = startLiveStatus();
}

/**
 * Keeps the screen truthful while the tab sits open.
 *
 * Two cheap things, neither of which calls a platform API:
 *  - repaint the countdowns on a timer, so they don't freeze at whatever they
 *    said when the page loaded;
 *  - re-read the vault when the tab regains focus, so changes made overnight by
 *    the cron, or on another device, show up.
 */
function startLiveStatus() {
  const timer = setInterval(() => {
    if (isBusy()) return;
    paintStatuses();
  }, TICK_MS);

  const onFocus = async () => {
    if (isBusy()) return;
    try {
      records = await vault.loadAll();
      paintStatuses();
    } catch {
      /* a background re-read failing must not blank the screen */
    }
  };
  window.addEventListener("focus", onFocus);

  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}

/**
 * True while the user is part-way through something a repaint would destroy -
 * an open JSON editor or a connect dialog.
 */
function isBusy() {
  return expanded.size > 0 || document.querySelector(".overlay") !== null;
}

async function reload() {
  try {
    records = await vault.loadAll();
  } catch (err) {
    root.innerHTML = `<p class="status-line error">${esc(err.message)}</p>`;
    return;
  }
  render();
}

async function runAutoRefresh() {
  await applyRefreshResult(await refreshStale(records));
}

/**
 * Reflects a background refresh pass on screen.
 *
 * Failures matter as much as successes here: a platform whose refresh just
 * started failing is exactly the case that used to leave a stale green status
 * sitting there until the page was reloaded by hand.
 */
async function applyRefreshResult({ refreshed = [], errors = [] } = {}) {
  if (refreshed.length || errors.length) await reload();
  if (errors.length) {
    setStatus(errors.map((e) => `${e.id}: ${e.message}`).join("  "), true);
  } else if (refreshed.length) {
    // A clean pass clears whatever the last failure left on screen.
    setStatus("");
  }
}

async function resumeRedirect() {
  const pending = consumePendingRedirect();
  if (!pending) return;
  if (pending.error) return setStatus(pending.error, true);

  try {
    const result = await call("steam", "openid_verify", {
      params: pending.params,
    });
    await vault.save(
      pending.platform,
      await PLATFORMS[pending.platform].connect(result.steamId),
    );
    clearFailure(pending.platform);
    await reload();
  } catch (err) {
    setStatus(err.message, true);
  }
}

/* ------------------------------------------------------------- rendering -- */

function status(def, record) {
  if (!record) return { cls: "bad", text: "not connected" };

  // A failing auto-refresh is the thing that silently breaks an integration,
  // so it outranks everything else.
  if (record.last_refresh_error) {
    return { cls: "bad", text: "refresh failing - reconnect" };
  }

  if (def.neverExpires) return { cls: "ok", text: "connected" };

  const left = (iso) => (iso ? new Date(iso).getTime() - Date.now() : null);
  const access = left(record.expires_at);
  const refresh = left(record.refresh_expires_at);

  // Only the renewing credential lapsing forces a manual reconnect; the access
  // token is minted again automatically.
  if (hasRefreshMaterial(def, record)) {
    if (refresh !== null && refresh <= 0)
      return { cls: "bad", text: "expired - reconnect" };
    return {
      cls: "ok",
      text: refresh ? `auto - ${dur(refresh)} left` : "auto",
    };
  }
  if (access === null) return { cls: "warn", text: "connected" };
  if (access <= 0) return { cls: "bad", text: "expired - reconnect" };
  return { cls: "warn", text: `${dur(access)} left` };
}

function dur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function render() {
  root.innerHTML = `
    <p class="meta">
      Credentials are stored against your account and used to call the platform APIs.
    </p>
    ${Object.entries(PLATFORMS)
      .map(([id, def]) => row(id, def))
      .join("")}
    <p class="status-line" id="conn-status"></p>
  `;

  setStatus(statusMsg.text, statusMsg.isError);

  root.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () =>
      handle(btn.dataset.act, btn.dataset.id),
    );
  });
  root.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveEdit(btn.dataset.save));
  });
}

/**
 * Updates the dot and the status text in place.
 *
 * Deliberately not a `render()` - rebuilding the list would wipe an open JSON
 * editor, drop the status line and steal focus. This only rewrites the two
 * things that actually change as time passes.
 */
function paintStatuses() {
  if (!root) return;
  for (const [id, def] of Object.entries(PLATFORMS)) {
    const st = status(def, records[id]);
    const dot = root.querySelector(`[data-dot="${id}"]`);
    if (dot) dot.className = `dot ${st.cls}`;
    const text = root.querySelector(`[data-status="${id}"]`);
    if (text) text.textContent = st.text;
  }
}

function row(id, def) {
  const record = records[id];
  const st = status(def, record);
  const name = record?.identity?.name ?? "";
  const isOpen = expanded.has(id);

  return `
    <div class="prow">
      <div class="prow-head">
        <span class="dot ${st.cls}" data-dot="${id}"></span>
        <span class="prow-name">${esc(def.label)}</span>
        <span class="meta">${esc(name)}</span>
        <span class="meta prow-status" data-status="${id}">${esc(st.text)}</span>
        <span class="prow-btns">
          <button data-act="connect" data-id="${id}">${record ? "reconnect" : "connect"}</button>
          ${def.canRefresh && record ? `<button data-act="refresh" data-id="${id}">refresh</button>` : ""}
          ${record ? `<button data-act="edit" data-id="${id}">${isOpen ? "hide" : "edit"}</button>` : ""}
          ${record ? `<button data-act="delete" data-id="${id}">delete</button>` : ""}
        </span>
      </div>
      ${
        isOpen
          ? `<div class="prow-body">
               <label>credentials + expiry (editable JSON)</label>
               <textarea id="edit-${id}" rows="10">${esc(editorJson(record))}</textarea>
               <div class="button-row spaced-top">
                 <button data-save="${id}">save</button>
               </div>
             </div>`
          : ""
      }
    </div>
  `;
}

function editorJson(record) {
  return JSON.stringify(
    {
      credentials: record.credentials ?? {},
      expires_at: record.expires_at,
      refresh_expires_at: record.refresh_expires_at,
      // Connect-time snapshot, not kept up to date. Profile data will live
      // in its own table.
      identity: record.identity ?? {},
      last_refresh_at: record.last_refresh_at,
      last_refresh_error: record.last_refresh_error,
    },
    null,
    2,
  );
}

async function saveEdit(id) {
  const text = root.querySelector(`#edit-${id}`).value;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return setStatus(`Invalid JSON: ${err.message}`, true);
  }
  try {
    await vault.save(id, {
      credentials: parsed.credentials ?? {},
      identity: parsed.identity,
      expiresAt: parsed.expires_at ?? null,
      refreshExpiresAt: parsed.refresh_expires_at ?? null,
      // Editing by hand clears a stale failure so auto-refresh resumes.
      lastRefreshError: parsed.last_refresh_error ?? null,
    });
    clearFailure(id);
    await reload();
    setStatus(`${id} saved.`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function setStatus(msg, isError = false) {
  // Errors share the status line's look, so they say so in words.
  const text =
    isError && !/^error:/i.test(msg ?? "") ? `Error: ${msg}` : (msg ?? "");
  statusMsg = { text, isError };
  const el = root?.querySelector("#conn-status");
  if (!el) return;
  el.textContent = statusMsg.text;
  el.classList.toggle("error", statusMsg.isError);
}

/* --------------------------------------------------------------- actions -- */

async function handle(action, id) {
  if (action === "edit") {
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    return render();
  }
  if (action === "delete") {
    try {
      await vault.remove(id);
      expanded.delete(id);
      await reload();
    } catch (err) {
      setStatus(err.message, true);
    }
    return;
  }
  if (action === "refresh") {
    const def = PLATFORMS[id];
    setStatus(`refreshing ${id}...`);
    try {
      const updated = await def.refresh(records[id]);
      // Access only - the identity snapshot is left untouched on purpose.
      await vault.save(id, {
        credentials: updated.credentials,
        expiresAt: updated.expiresAt,
        refreshExpiresAt: updated.refreshExpiresAt,
        lastRefreshAt: new Date().toISOString(),
        lastRefreshError: null,
      });
      await reload();
      setStatus(`${id} refreshed.`);
    } catch (err) {
      setStatus(err.message, true);
    }
    return;
  }
  if (action === "connect") return beginConnect(id);
}

async function beginConnect(id) {
  const def = PLATFORMS[id];

  // Mobile: redirect instead of popup. Nothing may be awaited before this.
  if (def.connectMode === "openid" && shouldUseRedirect()) {
    return beginSteamRedirect();
  }

  // Cookie platforms open nothing. Loading an EA page here would make EA
  // re-issue the cookies the user is in the middle of copying.
  const popup = def.cookieHint
    ? null
    : def.connectMode === "openid"
      ? openPopup(steamOpenIdUrl())
      : openPopup(def.loginUrl ?? def.authUrl);

  if (!popup && !def.cookieHint)
    return setStatus("Popup blocked - allow popups for this site.", true);

  try {
    const value =
      def.connectMode === "openid"
        ? await viaOpenId(popup)
        : await viaClipboard(def, popup);

    setStatus(`connecting ${id}...`);
    const record = await def.connect(value);
    if (!record.identity && def.identify) {
      try {
        record.identity = await def.identify(record);
      } catch {
        record.identity = {};
      }
    }
    await vault.save(id, record);
    clearFailure(id);
    await reload();
    setStatus(`${id} connected.`);
  } catch (err) {
    closePopup(popup);
    setStatus(err.message, true);
  }
}

async function viaOpenId(popup) {
  const params = await awaitSteamOpenId(popup);
  // Verify the signature server-side before trusting the SteamID.
  return (await call("steam", "openid_verify", { params })).steamId;
}

function viaClipboard(def, popup) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => {
      settled = true;
      modal.close();
    };

    const modal = openModal(def, popup, {
      onSubmit: (text) => {
        // Cookie platforms must parse cleanly. Falling back to the raw text
        // would post a whole cURL command to EA and fail confusingly.
        const value = def.cookieHint
          ? def.extract(text)
          : (def.extract(text) ?? text.trim());
        if (!value) {
          return def.cookieHint
            ? `Couldn't find the ${def.cookieHint.cookieNames[0]} cookie in that. Paste the whole "Copy as cURL" text.`
            : "Doesn't look like a valid credential.";
        }
        done();
        closePopup(popup);
        resolve(value);
        return null;
      },
      onCancel: () => {
        done();
        closePopup(popup);
        reject(new Error("cancelled"));
      },
    });

    awaitClipboardCredential(popup, def.extract)
      .then((value) => {
        if (settled) return;
        done();
        resolve(value);
      })
      .catch(() => {
        /* manual paste remains */
      });
  });
}

/**
 * Two-step platforms (PSN, EA) need the user signed in on the platform first;
 * their credential endpoint only works against an existing session.
 *
 * EA is a third shape again: there is no endpoint that hands over a long-lived
 * credential, so the value has to be copied out of the browser's own cookie
 * store. `cookieHint` swaps the "get credential" button for those instructions.
 */
function openModal(def, popup, { onSubmit, onCancel }) {
  const twoStep = Boolean(def.loginUrl);
  const hint = def.cookieHint;
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  let guidance;
  if (hint) {
    guidance = `
      <p class="meta">Make sure you're signed in to EA in this browser, then
        leave EA alone - reloading it can replace the cookies you're about to
        copy.</p>
      <ol class="meta">
        <li>Open <strong>https://${esc(hint.domain)}</strong> in a new tab.</li>
        <li>Press <strong>F12</strong>, open the <strong>Network</strong> tab,
            then reload the page.</li>
        <li>Right-click the first request in the list and choose
            <strong>Copy &rarr; Copy as cURL</strong>.</li>
        <li>Paste it below. Only the ${hint.cookieNames
          .map((n) => `<strong>${esc(n)}</strong>`)
          .join(", ")} values are kept.</li>
      </ol>
      <p class="meta">This is the long-lived sign-in, so it only needs doing
        every few months.</p>`;
  } else if (twoStep) {
    guidance = `
      <p class="meta">1. Sign in on the window that opened.
        2. Press <strong>get credential</strong>. 3. Copy the value -
        it's picked up automatically, or paste it below.</p>
      <div class="button-row">
        <button data-role="login" type="button">sign in</button>
        <button data-role="fetch" type="button">get credential</button>
      </div>`;
  } else {
    guidance = `
      <p class="meta">Copy the value from the window that opened -
        it's picked up automatically, or paste it below.</p>`;
  }

  overlay.innerHTML = `
    <div class="modal">
      <h3>${esc(def.label)}</h3>
      ${guidance}
      <label>${esc(def.credentialLabel)}</label>
      ${
        hint
          ? `<textarea data-role="manual" rows="4" spellcheck="false"></textarea>`
          : `<input type="text" data-role="manual" autocomplete="off" />`
      }
      <p class="status-line error" data-role="err"></p>
      <div class="modal-actions">
        <button data-role="cancel">cancel</button>
        <button data-role="submit">connect</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('[data-role="manual"]');
  const err = overlay.querySelector('[data-role="err"]');
  const submit = () => {
    const message = onSubmit(input.value);
    if (message) err.textContent = message;
  };

  overlay
    .querySelector('[data-role="submit"]')
    .addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  overlay
    .querySelector('[data-role="cancel"]')
    .addEventListener("click", onCancel);
  overlay
    .querySelector('[data-role="login"]')
    ?.addEventListener("click", () => openPopup(def.loginUrl));
  overlay
    .querySelector('[data-role="fetch"]')
    ?.addEventListener("click", () => openPopup(def.authUrl));

  return { close: () => overlay.remove() };
}

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
