import { PLATFORMS, KEYLESS_PLATFORMS } from "../platforms.js";
import * as vault from "../vault.js";
import { call } from "../api.js";
import { ensureFresh } from "../refresh.js";
import { fieldsFor } from "../schemas.js";

const ALL = { ...PLATFORMS, ...KEYLESS_PLATFORMS };

let root;
let records = {};
let rawMode = false;

export async function mount(el) {
  root = el;
  render();
  await refreshRecords();
  renderForm();
}

async function refreshRecords() {
  try {
    records = await vault.loadAll();
  } catch {
    records = {};
  }
}

function render() {
  root.innerHTML = `
    <div class="console-grid">
      <div class="console-controls">
        <div class="control">
          <label for="c-platform">Platform</label>
          <select id="c-platform">
            ${Object.entries(ALL)
              .map(([id, def]) => `<option value="${id}">${def.label}</option>`)
              .join("")}
          </select>
        </div>
        <div class="control">
          <label for="c-action">Action</label>
          <select id="c-action"></select>
        </div>
        <button id="c-run">Run</button>
      </div>

      <p class="meta" id="c-hint"></p>

      <div id="c-fields"></div>

      <div class="button-row">
        <button id="c-toggle-raw" type="button">edit as JSON</button>
        <button id="c-reset" type="button">reset fields</button>
      </div>

      <pre class="output" id="c-output">Pick an action and press Run.</pre>
    </div>
  `;

  root.querySelector("#c-platform").addEventListener("change", () => {
    fillActions();
    renderForm();
  });
  root.querySelector("#c-action").addEventListener("change", renderForm);
  root.querySelector("#c-run").addEventListener("click", run);
  root.querySelector("#c-reset").addEventListener("click", renderForm);
  root.querySelector("#c-toggle-raw").addEventListener("click", () => {
    rawMode = !rawMode;
    renderForm();
  });

  fillActions();
}

function fillActions() {
  const platform = root.querySelector("#c-platform").value;
  root.querySelector("#c-action").innerHTML = ALL[platform].actions
    .map((a) => `<option value="${a}">${a}</option>`)
    .join("");
}

function current() {
  return {
    platform: root.querySelector("#c-platform").value,
    action: root.querySelector("#c-action").value,
  };
}

/* ----------------------------------------------------------------- form -- */

function renderForm() {
  const { platform, action } = current();
  const fields = fieldsFor(platform, action);
  const box = root.querySelector("#c-fields");
  const toggle = root.querySelector("#c-toggle-raw");

  updateHint(platform);
  toggle.textContent = rawMode ? "use form" : "edit as JSON";

  // No schema (shouldn't happen) or the user asked for raw JSON.
  if (!fields || rawMode) {
    box.innerHTML = `
      <label for="c-raw">Options (JSON)</label>
      <textarea id="c-raw" rows="6">${escapeHtml(JSON.stringify(defaultsFor(fields), null, 2))}</textarea>
    `;
    return;
  }

  if (!fields.length) {
    box.innerHTML = `<p class="meta">This action takes no options.${
      platform in PLATFORMS
        ? " Your stored credentials are sent automatically."
        : ""
    }</p>`;
    return;
  }

  box.innerHTML = `<div class="field-list">${fields.map(fieldHtml).join("")}</div>`;
}

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const req = f.required ? `<span class="req" title="required">*</span>` : "";
  const val = f.default ?? "";

  let input;
  if (f.type === "boolean") {
    input = `<input type="checkbox" id="${id}" data-name="${f.name}" data-type="boolean" ${f.default ? "checked" : ""} />`;
  } else if (f.type === "select") {
    input = `<select id="${id}" data-name="${f.name}" data-type="string">
      ${(f.options ?? [])
        .map(
          (o) =>
            `<option value="${escapeHtml(o)}" ${o === f.default ? "selected" : ""}>${o === "" ? "(not set)" : escapeHtml(o)}</option>`,
        )
        .join("")}
    </select>`;
  } else if (f.type === "json") {
    input = `<textarea id="${id}" data-name="${f.name}" data-type="json" rows="3" placeholder="${escapeHtml(f.placeholder ?? "")}">${escapeHtml(val)}</textarea>`;
  } else {
    input = `<input type="${f.type === "number" ? "number" : "text"}" id="${id}"
      data-name="${f.name}" data-type="${f.type}"
      value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder ?? "")}" />`;
  }

  return `
    <div class="field ${f.type === "boolean" ? "field-inline" : ""}">
      <label for="${id}">${escapeHtml(f.name)}${req}</label>
      ${input}
      ${f.hint ? `<p class="meta">${escapeHtml(f.hint)}</p>` : ""}
    </div>
  `;
}

function defaultsFor(fields) {
  const out = {};
  for (const f of fields ?? []) {
    if (f.default !== undefined) out[f.name] = f.default;
  }
  return out;
}

/**
 * Reads the form back into an options object.
 * Returns { options } or { error } so Run can report problems inline.
 */
function collectOptions() {
  if (rawMode || !root.querySelector(".field-list")) {
    const raw = root.querySelector("#c-raw");
    if (!raw) return { options: {} };
    try {
      const text = raw.value.trim();
      return { options: text ? JSON.parse(text) : {} };
    } catch (err) {
      return { error: `Options is not valid JSON: ${err.message}` };
    }
  }

  const { platform, action } = current();
  const schema = fieldsFor(platform, action) ?? [];
  const options = {};

  for (const el of root.querySelectorAll("[data-name]")) {
    const name = el.dataset.name;
    const type = el.dataset.type;
    const def = schema.find((f) => f.name === name);

    if (type === "boolean") {
      if (el.checked) options[name] = true;
      continue;
    }

    const value = el.value.trim();
    if (value === "") {
      if (def?.required) return { error: `"${name}" is required.` };
      continue;
    }

    if (type === "number") {
      const n = Number(value);
      if (Number.isNaN(n)) return { error: `"${name}" must be a number.` };
      options[name] = n;
    } else if (type === "json") {
      try {
        options[name] = JSON.parse(value);
      } catch (err) {
        return { error: `"${name}" is not valid JSON: ${err.message}` };
      }
    } else {
      options[name] = value;
    }
  }

  for (const f of schema) {
    if (f.required && !(f.name in options)) {
      return { error: `"${f.name}" is required.` };
    }
  }

  return { options };
}

function updateHint(platform) {
  const hint = root.querySelector("#c-hint");
  if (!(platform in PLATFORMS)) {
    hint.textContent = "Uses server-side keys - no connection required.";
    return;
  }
  hint.textContent = records[platform]
    ? "Using your stored credentials for this platform."
    : "Not connected. Connect this platform first or the call will fail.";
}

/* ------------------------------------------------------------------ run -- */

async function run() {
  const { platform, action } = current();
  const output = root.querySelector("#c-output");
  const button = root.querySelector("#c-run");

  const collected = collectOptions();
  if (collected.error) {
    output.textContent = collected.error;
    return;
  }

  const def = PLATFORMS[platform];
  let credentials = {};
  if (def) {
    // Top the token up first so a stale one doesn't fail the call.
    await ensureFresh(platform);
    await refreshRecords();
    updateHint(platform);
    const record = records[platform];
    // Don't block when disconnected - let the handler return the real error.
    if (record) credentials = def.callCredentials(record);
  }

  button.disabled = true;
  output.textContent = "Running...";
  const startedAt = performance.now();

  try {
    const result = await call(platform, action, collected.options, credentials);
    const ms = Math.round(performance.now() - startedAt);
    output.textContent =
      `// ${platform}.${action} - ${ms}ms\n` +
      `// sent: ${JSON.stringify(collected.options)}\n\n` +
      JSON.stringify(result, null, 2);
  } catch (err) {
    const ms = Math.round(performance.now() - startedAt);
    output.textContent =
      `// ${platform}.${action} - FAILED after ${ms}ms (status ${err.status ?? "?"})\n` +
      `// sent: ${JSON.stringify(collected.options)}\n\n` +
      err.message;
  } finally {
    button.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
