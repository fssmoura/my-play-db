// The library sync's two visible parts. Looks live in /css/sync-indicator.css.
//
// The pill: a glass pill at the top centre, in line with the other top
// controls, while library.sync() runs (app open, pull to refresh). "Syncing"
// on the left, a ring on the right filled clockwise to the real share done
// (see sync() in library.js); when the sync ends the ring closes and the pill
// slides back up. It lives in the menu stage, so menu.js gives it its lens;
// it slides with --sync-show, as liquidGL lenses move by top, never
// transform. Off home (search or a game page, Back showing) the centre of the
// row is taken, so it stays away there.
//
// Pull to refresh: dragging down on home reveals a spoked icon whose spokes
// light up one by one as the pull nears the point of release; let go past it
// and onRefresh runs. A
// finger or a mouse drag. The page itself never moves (html has no
// rubber-band).

import { createSpring } from "/js/spring.js";

const HOLD_MS = 600;
const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

export function createSyncPill(library) {
  const stage = document.getElementById("app-menu-stage");
  const pill = document.createElement("div");
  pill.id = "app-sync";
  pill.className = "sync-pill";
  pill.setAttribute("role", "progressbar");
  pill.setAttribute("aria-label", "Syncing library");
  pill.setAttribute("aria-valuemin", "0");
  pill.setAttribute("aria-valuemax", "100");
  pill.innerHTML = `<span class="sync-pill-label">Syncing</span><svg class="sync-pill-ring" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle class="sync-pill-track" cx="10" cy="10" r="${RING_R}"/><circle class="sync-pill-fill" cx="10" cy="10" r="${RING_R}" transform="rotate(-90 10 10)" stroke-dasharray="${RING_C.toFixed(2)}"/></svg>`;
  const fill = pill.querySelector(".sync-pill-fill");
  (stage ?? document.body).append(pill);

  let value = 0;
  let running = false;
  let visible = false;
  let hold = null;

  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spring = createSpring({
    onUpdate: (v) => pill.style.setProperty("--sync-show", v.toFixed(4)),
    onRest: (target) => {
      if (target !== 0) return;
      pill.classList.remove("is-on");
      if (!visible) set(0, { instant: true });
    },
  });

  function set(next, { instant = false } = {}) {
    value = next;
    fill.classList.toggle("is-instant", instant);
    fill.style.strokeDashoffset = (RING_C * (1 - value)).toFixed(2);
    pill.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  }

  const blocked = () => stage?.classList.contains("is-back-active") ?? false;

  // Centred, unless a narrow phone would put it under the top-right menu:
  // then just far enough left to keep the 8px gap, never past the margin.
  function place() {
    const bar = stage?.querySelector(".menu-bar");
    if (!bar || !pill.classList.contains("is-on")) return;
    const width = pill.offsetWidth;
    const room = bar.getBoundingClientRect().left - 8 - width;
    const left = Math.max(25, Math.min((window.innerWidth - width) / 2, room));
    pill.style.left = `${left}px`;
  }

  function update() {
    if (visible && !blocked()) {
      pill.classList.add("is-on");
      place();
      spring.to(1, { instant: reducedMotion() });
    } else {
      spring.to(0, { instant: reducedMotion() });
    }
  }

  function start() {
    clearTimeout(hold);
    running = true;
    visible = true;
    set(0, { instant: true });
    update();
    // Next frame, so the first move animates from empty.
    requestAnimationFrame(() => {
      if (running) set(Math.max(value, 0.03));
    });
  }

  function progress(share) {
    if (running && share > value) set(share);
  }

  function end() {
    running = false;
    set(1);
    hold = setTimeout(() => {
      visible = false;
      update();
    }, HOLD_MS);
  }

  // Back slides in when search or a game page opens: step aside for it.
  let wasBlocked = blocked();
  const observer = new MutationObserver(() => {
    if (blocked() === wasBlocked) return;
    wasBlocked = blocked();
    update();
  });
  if (stage) observer.observe(stage, { attributeFilter: ["class"] });
  window.addEventListener("resize", place);

  set(0, { instant: true });
  const offs = [
    library.on("syncstart", start),
    library.on("syncprogress", progress),
    library.on("syncend", end),
  ];
  if (library.syncing) start();

  return {
    destroy() {
      offs.forEach((off) => off());
      observer.disconnect();
      window.removeEventListener("resize", place);
      clearTimeout(hold);
      spring.destroy();
      pill.remove();
    },
  };
}

// How far the pull goes (px, half the finger's travel) to arm a refresh, and
// the most it can. The icon slides down until it lines up with the top menu
// at SHOWN_PX, then stays put; its spokes light from LIGHT_PX to ARM_PX.
const SHOWN_PX = 40;
const LIGHT_PX = 24;
const ARM_PX = 85;
const MAX_PX = 130;
// The owner's spoke icon, split into its spokes, clockwise from the top.
const SPOKES = [
  "M11.986.747v6",
  "M18.158 4.253L16.394 6.68",
  "M21.972 9.503l-2.853.927",
  "M21.972 15.992l-2.853-.927",
  "M18.158 21.242l-1.764-2.427",
  "M11.986 23.247v-3",
  "M5.814 21.242l1.764-2.427",
  "M2 15.992l2.853-.927",
  "M2 9.503l2.853.927",
  "M5.814 4.253L7.578 6.68",
];

export function wirePullToRefresh({ canPull, onRefresh }) {
  const ring = document.createElement("div");
  ring.className = "pull-refresh";
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">${SPOKES.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
  const spokes = [...ring.querySelectorAll("path")];
  document.body.append(ring);

  let startY = null;
  let pulled = 0;

  // Each spoke lights up in turn as the pull nears the point of release.
  function draw(distance) {
    pulled = distance;
    const t = Math.min(
      Math.max((distance - LIGHT_PX) / (ARM_PX - LIGHT_PX), 0),
      1,
    );
    ring.classList.toggle("is-armed", t >= 1);
    ring.style.opacity = String(Math.min(distance / SHOWN_PX, 1));
    ring.style.transform = `translate(-50%, ${Math.min(distance, SHOWN_PX) - SHOWN_PX}px)`;
    const lit = Math.floor(t * spokes.length);
    spokes.forEach((spoke, i) => spoke.classList.toggle("is-lit", i < lit));
  }

  function release() {
    ring.classList.add("is-releasing");
    ring.classList.remove("is-armed");
    ring.style.opacity = "0";
    ring.style.transform = "translate(-50%, -40px)";
    pulled = 0;
  }

  function begin(y, event) {
    startY = null;
    if (window.scrollY > 0 || !canPull(event)) return;
    startY = y;
    ring.classList.remove("is-releasing");
  }

  function follow(y) {
    if (startY === null) return;
    const dy = y - startY;
    // A mouse drag would otherwise select text on the way.
    if (dy > 4) document.documentElement.classList.add("is-pulling");
    draw(Math.min(Math.max(dy, 0) / 2, MAX_PX));
  }

  function onEnd() {
    if (startY === null) return;
    startY = null;
    document.documentElement.classList.remove("is-pulling");
    const armed = pulled >= ARM_PX;
    release();
    if (armed) onRefresh();
  }

  function onCancel() {
    if (startY === null) return;
    startY = null;
    document.documentElement.classList.remove("is-pulling");
    release();
  }

  // Touch on phones; a left-button mouse drag does the same on a computer.
  const onTouchStart = (event) => {
    if (event.touches.length === 1) begin(event.touches[0].clientY, event);
    else startY = null;
  };
  const onTouchMove = (event) => {
    if (event.touches.length !== 1) onCancel();
    else follow(event.touches[0].clientY);
  };
  const onMouseDown = (event) => {
    if (event.button === 0) begin(event.clientY, event);
  };
  const onMouseMove = (event) => follow(event.clientY);

  const opts = { passive: true };
  const handlers = [
    ["touchstart", onTouchStart],
    ["touchmove", onTouchMove],
    ["touchend", onEnd],
    ["touchcancel", onCancel],
    ["mousedown", onMouseDown],
    ["mousemove", onMouseMove],
    ["mouseup", onEnd],
  ];
  for (const [type, fn] of handlers) document.addEventListener(type, fn, opts);
  window.addEventListener("blur", onCancel);

  return () => {
    for (const [type, fn] of handlers)
      document.removeEventListener(type, fn, opts);
    window.removeEventListener("blur", onCancel);
    ring.remove();
  };
}
