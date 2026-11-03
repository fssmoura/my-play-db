// The Preview tab of the Customize drawer: the chosen poster, logo and banner
// at full size, each with its name and pixel size above it and "Add
// Manually" below, which swaps for a URL field with its own Save (that only
// shows the image here). Behaviour only; the look is in css/customize.css.
//
//   createPreview({ onManual }) -> { element, render(picks), setStatus, destroy }
//
// picks: { cover, banner, logo }, each { url, width, height } or null. A
// manual URL is loaded here first; only an image that loads is handed to
// onManual(kind, { url, width, height }).

import { displayImageUrl, loadImageForGlass } from "/js/image-url.js";
import { createOverlayScroll } from "/js/overlay-scroll.js";
import { createViewer } from "/js/customize-viewer.js";

const SLOTS = [
  { kind: "cover", label: "Poster" },
  { kind: "logo", label: "Logo" },
  { kind: "banner", label: "Banner" },
];

const sizeText = (pick) =>
  pick?.width && pick?.height ? `${pick.width} × ${pick.height}` : "";

export function createPreview({ onManual, viewerClose }) {
  const element = document.createElement("div");
  element.className = "customize-pane overlay-scroll-host";
  element.hidden = true;
  const layout = document.createElement("div");
  layout.className = "preview-layout";
  const status = document.createElement("p");
  status.className = "preview-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  element.append(layout, status);

  let overlay = null;
  let picks = {};
  const slots = new Map();
  const viewer = createViewer({ closeCircle: viewerClose });

  // Clickable (a button that opens it full screen) only once its image is in.
  function setViewable(slot, on) {
    slot.frame.classList.toggle("is-viewable", on);
    slot.frame.setAttribute("role", on ? "button" : "img");
    slot.frame.setAttribute(
      "aria-label",
      on ? `View ${slot.label} Full Screen` : slot.label,
    );
    if (on) slot.frame.tabIndex = 0;
    else slot.frame.removeAttribute("tabindex");
  }

  for (const { kind, label } of SLOTS) {
    const figure = document.createElement("figure");
    figure.className = `preview-slot is-${kind}`;
    const frame = document.createElement("div");
    frame.className = "preview-frame";
    frame.setAttribute("role", "img");
    frame.setAttribute("aria-label", label);
    const caption = document.createElement("figcaption");
    caption.className = "preview-head";
    const name = document.createElement("span");
    name.className = "preview-name";
    name.textContent = label;
    const size = document.createElement("span");
    size.className = "preview-size";
    caption.append(name, size);

    const foot = document.createElement("div");
    foot.className = "preview-foot";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "preview-add";
    add.innerHTML =
      'Add Manually<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z"/></svg>';
    const info = add;

    // The URL and its Save: Save (or Enter) only shows it here; the drawer's
    // own Save is what stores it.
    const field = document.createElement("div");
    field.className = "field preview-field";
    field.hidden = true;
    const input = document.createElement("input");
    input.type = "url";
    input.placeholder = "Image URL";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.enterKeyHint = "done";
    input.setAttribute("aria-label", `${label} image URL`);
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "preview-submit";
    submit.textContent = "Save";
    const row = document.createElement("div");
    row.className = "preview-field-row";
    row.append(input, submit);
    const note = document.createElement("p");
    note.className = "preview-note";
    note.hidden = true;
    field.append(row, note);
    foot.append(add, field);

    // Name and size above the image, as wide as it; then the image; then
    // "Add Manually" or the field.
    const body = document.createElement("div");
    body.className = "preview-body";
    body.append(caption, frame, foot);
    figure.append(body);
    layout.append(figure);
    const slot = {
      kind,
      label,
      frame,
      size,
      add,
      info,
      field,
      input,
      note,
      token: 0,
    };
    slots.set(kind, slot);

    add.addEventListener("click", () => openField(slot));
    // A shown image is a button (HIG image views): it opens full screen.
    const view = (byKeyboard) => {
      const shown = frame.querySelector("img");
      if (!shown || !frame.classList.contains("is-viewable")) return;
      viewer.open(shown.currentSrc || shown.src, label, {
        byKeyboard,
      });
    };
    frame.addEventListener("click", (event) => view(event.detail === 0));
    frame.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      view(true);
    });
    submit.addEventListener("click", () => tryUrl(slot));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        tryUrl(slot);
      }
    });
    input.addEventListener("blur", (event) => {
      if (event.relatedTarget === submit) return;
      if (!input.value.trim() && !slot.busy) closeField(slot);
    });
  }

  function openField(slot) {
    slot.info.hidden = true;
    slot.field.hidden = false;
    slot.note.hidden = true;
    slot.input.value = "";
    slot.input.focus();
  }

  function closeField(slot, { refocus = false } = {}) {
    slot.field.hidden = true;
    slot.info.hidden = false;
    slot.busy = false;
    if (refocus) slot.add.focus();
  }

  function setNote(slot, text) {
    slot.note.textContent = text;
    slot.note.hidden = !text;
  }

  // Loads the typed URL as a hidden image first: only one that loads replaces
  // the slot's pick.
  function tryUrl(slot) {
    const raw = slot.input.value.trim();
    let url;
    try {
      url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      setNote(slot, "Enter a web address starting with https://");
      return;
    }
    slot.busy = true;
    setNote(slot, "Loading…");
    const mine = ++slot.token;
    const probe = new Image();
    loadImageForGlass(probe, displayImageUrl(url.href, "full"), {
      onLoad: () => {
        if (mine !== slot.token) return;
        closeField(slot);
        onManual?.(slot.kind, {
          url: url.href,
          width: probe.naturalWidth,
          height: probe.naturalHeight,
        });
      },
      onError: () => {
        if (mine !== slot.token) return;
        slot.busy = false;
        setNote(slot, "Couldn't load an image from that address.");
      },
    });
  }

  function fill(slot, pick) {
    const url = pick?.url ? displayImageUrl(pick.url, "full") : "";
    const current = slot.frame.querySelector("img");
    slot.size.textContent = sizeText(pick);
    if (current?.dataset.url === url && url) {
      // Same image already shown (e.g. after Reset): its own size stands in
      // when the pick carries none.
      if (!slot.size.textContent && current.complete && current.naturalWidth)
        slot.size.textContent = `${current.naturalWidth} × ${current.naturalHeight}`;
      return;
    }
    slot.frame.replaceChildren();
    setViewable(slot, false);
    slot.frame.classList.toggle("is-empty", !url);
    slot.frame.classList.remove("is-loading", "is-failed");
    if (!url) return;
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.dataset.url = url;
    slot.frame.classList.add("is-loading");
    loadImageForGlass(img, url, {
      onLoad: () => {
        slot.frame.classList.remove("is-loading");
        setViewable(slot, true);
        // Stored picks don't carry their size; the image itself does.
        if (!sizeText(picks[slot.kind]) && img.naturalWidth) {
          slot.size.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        }
      },
      onError: () => {
        slot.frame.classList.remove("is-loading");
        slot.frame.classList.add("is-failed");
      },
    });
    slot.frame.append(img);
  }

  return {
    element,
    // The full-screen viewer; the drawer puts it in its layer.
    viewerElement: viewer.element,
    render(next) {
      picks = { ...next };
      for (const slot of slots.values()) fill(slot, picks[slot.kind]);
    },
    activate() {
      overlay ??= createOverlayScroll({
        scroller: element,
        content: layout,
        top: 4,
        bottom: 4,
      });
      overlay.update();
    },
    setStatus(text) {
      status.textContent = text;
      status.hidden = !text;
    },
    // Escape closes the full-screen image first. True when it did.
    closeViewer() {
      if (!viewer.isOpen) return false;
      viewer.close();
      return true;
    },
    // Escape inside a URL field closes that field, not the drawer (the
    // drawer's Escape listener asks first). True when it did.
    cancelField(target) {
      for (const slot of slots.values()) {
        if (!slot.field.hidden && slot.field.contains(target)) {
          slot.token += 1;
          closeField(slot, { refocus: true });
          return true;
        }
      }
      return false;
    },
    // Fresh for each opening: no field left open from last time.
    reset() {
      for (const slot of slots.values()) {
        closeField(slot);
        setNote(slot, "");
      }
      status.hidden = true;
      element.scrollTop = 0;
    },
    destroy() {
      viewer.destroy();
      overlay?.destroy();
    },
  };
}
