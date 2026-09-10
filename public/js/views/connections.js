import { PLATFORMS } from "../platforms.js";
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
const expanded = new Set();

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
    async () => await reload(),
  );
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
  const { refreshed, errors } = await refreshStale(records);
  if (refreshed.length) await reload();
  if (errors.length) {
    setStatus(errors.map((e) => `${e.id}: ${e.message}`).join("  "), true);
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
  if (def.neverExpires) return { cls: "ok", text: "connected" };

  const left = (iso) => (iso ? new Date(iso).getTime() - Date.now() : null);
  const access = left(record.expires_at);
  const refresh = left(record.refresh_expires_at);

  // Only the refresh token lapsing forces a manual reconnect; the access
  // token is minted again automatically.
  if (def.canRefresh && record.credentials?.refreshToken) {
    if (refresh !== null && refresh <= 0)
      return { cls: "bad", text: "expired - reconnect" };
    return {
      cls: "ok",
      text: refresh ? `auto  ${dur(refresh)} left` : "auto",
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

  root.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () =>
      handle(btn.dataset.act, btn.dataset.id),
    );
  });
  root.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveEdit(btn.dataset.save));
  });
}

function row(id, def) {
  const record = records[id];
  const st = status(def, record);
  const name = record?.identity?.name ?? "";
  const isOpen = expanded.has(id);

  return `
    <div class="prow">
      <div class="prow-head">
        <span class="dot ${st.cls}"></span>
        <span class="prow-name">${esc(def.label)}</span>
        <span class="meta">${esc(name)}</span>
        <span class="meta prow-status">${esc(st.text)}</span>
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
      identity: record.identity ?? {},
      expires_at: record.expires_at,
      refresh_expires_at: record.refresh_expires_at,
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
      identity: parsed.identity ?? {},
      expiresAt: parsed.expires_at ?? null,
      refreshExpiresAt: parsed.refresh_expires_at ?? null,
    });
    clearFailure(id);
    await reload();
    setStatus(`${id} saved.`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function setStatus(msg, isError = false) {
  const el = root.querySelector("#conn-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", isError);
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
      updated.identity ??= records[id].identity;
      await vault.save(id, updated);
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

  // window.open must be synchronous inside the click handler.
  const popup =
    def.connectMode === "openid"
      ? openPopup(steamOpenIdUrl())
      : openPopup(def.loginUrl ?? def.authUrl);

  if (!popup)
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
        const value = def.extract(text) ?? text.trim();
        if (!value) return "Doesn't look like a valid credential.";
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
 */
function openModal(def, popup, { onSubmit, onCancel }) {
  const twoStep = Boolean(def.loginUrl);
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>${esc(def.label)}</h3>
      ${
        twoStep
          ? `<p class="meta">1. Sign in on the window that opened.
               2. Press <strong>get credential</strong>. 3. Copy the value -
               it's picked up automatically, or paste it below.</p>
             <div class="button-row">
               <button data-role="login" type="button">sign in</button>
               <button data-role="fetch" type="button">get credential</button>
             </div>`
          : `<p class="meta">Copy the value from the window that opened -
               it's picked up automatically, or paste it below.</p>`
      }
      <label>${esc(def.credentialLabel)}</label>
      <input type="text" data-role="manual" autocomplete="off" />
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
