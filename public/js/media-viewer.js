// The game page's full-screen viewer for its Trailers and Images (game-media.js).
// One at a time, over everything (css/game-media.css). Behaviour only.
//
//   openMediaViewer({ section, caption, items, index, opener, behind })
//
// - section: the section's name ("Trailers", "Images"), shown top left.
// - caption: the small grey line over each item's title (the game's name).
// - items: [{ title, image }] for pictures, [{ title, videoId }] for trailers.
// - index: the item to start on. opener: focused again on close.
// - behind: the element underneath, made inert while the viewer is up.
// - onSetAs(kind, item): pictures only. Adds the top-right "Set as" menu
//   (Poster, Logo, Banner, each confirmed first); kind is "cover", "logo" or
//   "banner". Its promise rejecting shows an error in the confirmation.
//
// Dragging a picture sideways (or the arrow keys, or the dots) moves between
// items; trailers change only with the keys or dots. A trailer plays at once
// with only the browse chrome (titles and dots); a tap brings up the player
// controls, which hide again after a few seconds of playback. Escape closes.

import { createYouTubePlayer, youTubeStills } from "/js/youtube-player.js";

const NS = "http://www.w3.org/2000/svg";
const PATHS = {
  close:
    '<path fill="currentColor" d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.29 6.3 1.42-1.42-6.3-6.29 6.3-6.3z"/>',
  play: '<path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/>',
  pause:
    '<rect fill="currentColor" x="6" y="4.5" width="4" height="15" rx="1.2"/><rect fill="currentColor" x="14" y="4.5" width="4" height="15" rx="1.2"/>',
  back: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4a8.5 8.5 0 1 1-7.36 4.25"/><path d="M14.5 1.5 12 4l2.5 2.5"/></g><text x="12.5" y="16" text-anchor="middle" font-size="7.5" font-weight="600" fill="currentColor" font-family="system-ui, sans-serif">10</text>',
  forward:
    '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4a8.5 8.5 0 1 0 7.36 4.25"/><path d="M9.5 1.5 12 4 9.5 6.5"/></g><text x="11.5" y="16" text-anchor="middle" font-size="7.5" font-weight="600" fill="currentColor" font-family="system-ui, sans-serif">10</text>',
  volume:
    '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8"/></g>',
  muted:
    '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="m16.5 9.5 5 5m0-5-5 5"/>',
  fullscreen:
    '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  setAs:
    '<path fill="currentColor" d="m17.32 2.87l-2.36 2.37L13.73 4c-.38-.38-.88-.58-1.41-.58c-.54 0-1.04.21-1.42.59L8.96 5.96L2.3 12.61c-.19.19-.29.44-.29.71s.11.52.29.71l7.69 7.69c.2.2.45.29.71.29s.51-.1.71-.29l6.66-6.65l1.94-1.95c.78-.78.78-2.05 0-2.83l-1.23-1.23l2.44-2.44c.51-.51.79-1.19.79-1.91c0-.8-.36-1.56-.98-2.08c-1.06-.88-2.68-.78-3.7.24Zm-6.63 16.72l-6.28-6.28l5.25-5.24l3.14 3.14l3.14 3.14l-5.24 5.24Zm9.1-14.39l-3.14 3.15a.996.996 0 0 0 0 1.41l1.93 1.93l-1.24 1.24l-3.14-3.14l-3.14-3.14l1.24-1.24l1.94 1.94c.19.19.44.29.71.29s.52-.11.71-.29l3.07-3.08c.29-.29.74-.34 1-.12a.687.687 0 0 1 .05 1.03Z"/>',
};

// [kind, name, viewBox, icon]
const SET_AS = [
  [
    "cover",
    "Poster",
    "0 0 24 24",
    '<path fill="currentColor" d="M6 22q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h12q.825 0 1.413.588T20 4v16q0 .825-.587 1.413T18 22zm0-2h12V4H6zm5.25-3.5L10.1 15q-.15-.2-.4-.2t-.4.2l-1.675 2.2q-.2.25-.063.525t.463.275h7.95q.325 0 .462-.275t-.062-.525l-2.425-3.175q-.15-.2-.4-.2t-.4.2zM6 20V4z"/>',
  ],
  [
    "logo",
    "Logo",
    "0 0 256 256",
    '<path fill="currentColor" d="M156 80H48a20 20 0 0 0-20 20v108a20 20 0 0 0 20 20h108a20 20 0 0 0 20-20V100a20 20 0 0 0-20-20m-4 124H52V104h100ZM132 40a12 12 0 0 1 12-12h16a12 12 0 0 1 0 24h-16a12 12 0 0 1-12-12m96 8v8a12 12 0 0 1-24 0v-4h-4a12 12 0 0 1 0-24h8a20 20 0 0 1 20 20m0 48v16a12 12 0 0 1-24 0V96a12 12 0 0 1 24 0m0 56v8a20 20 0 0 1-20 20h-8a12 12 0 0 1 0-24h4v-4a12 12 0 0 1 24 0M76 56v-8a20 20 0 0 1 20-20h8a12 12 0 0 1 0 24h-4v4a12 12 0 0 1-24 0"/>',
  ],
  [
    "banner",
    "Banner",
    "0 0 24 24",
    '<g fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"><path d="M7 7a3 3 0 1 0 0 6a3 3 0 0 0 0-6m-1 3a1 1 0 1 1 2 0a1 1 0 0 1-2 0"/><path d="M3 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zm18 2H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4.314l6.878-6.879a3 3 0 0 1 4.243 0L22 15.686V6a1 1 0 0 0-1-1m0 14H10.142l5.465-5.464a1 1 0 0 1 1.414 0l4.886 4.886A1 1 0 0 1 21 19"/></g>',
  ],
];

function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "mv-icon");
  svg.innerHTML = PATHS[name];
  return svg;
}

function button(cls, label, iconName) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  if (iconName) b.append(icon(iconName));
  return b;
}

function setIcon(b, name) {
  b.replaceChildren(icon(name));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function clock(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const HIDE_AFTER = 2000;
const SWIPE = 50;
// Picture zoom, as in the Customize viewer: a double tap goes to ZOOM_TO, a
// pinch, the wheel or + / - up to MAX_ZOOM; 0 goes back.
const ZOOM_TO = 2.5;
const MAX_ZOOM = 8;
const DOUBLE_TAP_MS = 300;
const SLIDE_MS = 220;
// Dots beyond this many scroll, keeping the current one in view.
const MAX_DOTS = 9;
const DOT_STEP = 16;

let current = null;

export function closeMediaViewer() {
  current?.close();
}

export function isMediaViewerOpen() {
  return !!current;
}

export function openMediaViewer({
  section,
  caption,
  items,
  index = 0,
  opener = null,
  behind = null,
  onSetAs = null,
}) {
  current?.close();
  if (!items?.length) return;
  const isVideo = !!items[0].videoId;
  let at = Math.min(Math.max(0, index), items.length - 1);

  const root = el("div", "media-viewer");
  root.classList.toggle("is-video", isVideo);
  root.dataset.mode = "browse";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", section);
  root.setAttribute("data-liquid-ignore", "");

  // ---- the item itself ----
  const stage = el("div", "mv-stage");
  const frame = el("div", "mv-frame");
  stage.append(frame);

  // ---- top: close + section name; volume when the controls are up ----
  const top = el("div", "mv-top");
  const closeBtn = button("mv-close", "Close", "close");
  const left = el("div", "mv-top-left");
  left.append(closeBtn, el("span", "mv-section", section));
  top.append(left);
  // Pictures: "Set as" top right, when the page can store the choice.
  const setAs = !isVideo && onSetAs ? buildSetAs() : null;
  if (setAs) top.append(setAs.box);

  // ---- bottom (browse): caption, title, dots ----
  const browse = el("div", "mv-browse");
  const title = el("p", "mv-title");
  const dotsBox = el("div", "mv-dots");
  const dotsRow = el("div", "mv-dots-row");
  dotsBox.append(dotsRow);
  dotsBox.hidden = items.length < 2;
  const dots = items.map((item, i) => {
    const d = button("mv-dot", `${i + 1} of ${items.length}`);
    d.addEventListener("click", () => go(i));
    dotsRow.append(d);
    return d;
  });
  if (items.length > MAX_DOTS) dotsBox.style.width = `${MAX_DOTS * DOT_STEP}px`;
  browse.append(el("p", "mv-caption", caption || ""), title, dotsBox);
  root.append(stage, top, browse);
  if (setAs) root.append(setAs.overlay);

  // ---- player controls (trailers only) ----
  let player = null;
  const controls = isVideo ? buildControls() : null;

  function buildControls() {
    const volBox = el("div", "mv-volume");
    const slider = el("input", "mv-volume-slider");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "100";
    slider.setAttribute("aria-label", "Volume");
    const muteBtn = button("mv-btn mv-mute", "Mute", "volume");
    volBox.append(slider, muteBtn);
    top.append(volBox);

    const centre = el("div", "mv-centre");
    const backBtn = button("mv-btn mv-skip", "Back 10 seconds", "back");
    const playBtn = button("mv-btn mv-play", "Pause", "pause");
    const fwdBtn = button("mv-btn mv-skip", "Forward 10 seconds", "forward");
    centre.append(backBtn, playBtn, fwdBtn);

    const bar = el("div", "mv-bar");
    const barHead = el("div", "mv-bar-head");
    const barTitle = el("p", "mv-bar-title");
    const fsBtn = button("mv-btn mv-fs", "Full screen", "fullscreen");
    fsBtn.hidden = !document.fullscreenEnabled;
    barHead.append(barTitle, fsBtn);
    const scrub = el("div", "mv-scrub");
    const elapsed = el("span", "mv-time", "0:00");
    const track = el("div", "mv-track");
    track.setAttribute("role", "slider");
    track.setAttribute("aria-label", "Position");
    track.tabIndex = 0;
    const fill = el("div", "mv-fill");
    track.append(fill);
    const remaining = el("span", "mv-time mv-time-left", "-0:00");
    scrub.append(elapsed, track, remaining);
    const pill = el("button", "mv-pill", section);
    pill.type = "button";
    bar.append(barHead, scrub, pill);
    root.append(centre, bar);

    const showVolume = () => {
      const muted = !player || player.isMuted();
      setIcon(muteBtn, muted ? "muted" : "volume");
      muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      if (player) slider.value = String(muted ? 0 : player.volume());
    };
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      if (v === 0) player?.mute();
      else player?.setVolume(v);
      setIcon(muteBtn, v === 0 ? "muted" : "volume");
      poke();
    });
    muteBtn.addEventListener("click", () => {
      if (!player) return;
      if (player.isMuted()) player.unmute();
      else player.mute();
      // The player reports the change a moment later.
      setTimeout(showVolume, 60);
      poke();
    });

    backBtn.addEventListener("click", () => (player?.skip(-10), poke()));
    fwdBtn.addEventListener("click", () => (player?.skip(10), poke()));
    playBtn.addEventListener("click", () => (player?.toggle(), poke()));
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else root.requestFullscreen?.().catch(() => {});
      poke();
    });
    pill.addEventListener("click", () => setMode("browse"));

    // Scrubber: drag anywhere on the track; the video jumps on release.
    let dragging = false;
    const fraction = (x) => {
      const r = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (x - r.left) / r.width));
    };
    const showAt = (t, d) => {
      fill.style.width = `${d ? (t / d) * 100 : 0}%`;
      elapsed.textContent = clock(t);
      remaining.textContent = `-${clock(d - t)}`;
      track.setAttribute("aria-valuetext", `${clock(t)} of ${clock(d)}`);
    };
    const showPointer = (e) =>
      showAt(fraction(e.clientX) * player.duration(), player.duration());
    track.addEventListener("pointerdown", (e) => {
      if (!player) return;
      dragging = true;
      track.setPointerCapture(e.pointerId);
      track.classList.add("is-dragging");
      showPointer(e);
      poke();
    });
    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      showPointer(e);
      poke();
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("is-dragging");
      if (e.type === "pointerup")
        player.seek(fraction(e.clientX) * player.duration());
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    // Keeps the time current while the controls are up.
    let ticker = 0;
    const tick = () => {
      if (player && !dragging) showAt(player.time(), player.duration());
    };
    return {
      setTitle: (t) => (barTitle.textContent = t),
      setPlaying(p) {
        setIcon(playBtn, p ? "pause" : "play");
        playBtn.setAttribute("aria-label", p ? "Pause" : "Play");
      },
      start() {
        tick();
        showVolume();
        clearInterval(ticker);
        ticker = setInterval(tick, 250);
      },
      stop: () => clearInterval(ticker),
      showVolume,
    };
  }

  // ---- modes: browse (titles, dots) or controls ----
  let hideTimer = 0;
  function poke() {
    clearTimeout(hideTimer);
    if (root.dataset.mode !== "controls" || !player?.isPlaying()) return;
    hideTimer = setTimeout(() => setMode("browse"), HIDE_AFTER);
  }
  function setMode(mode) {
    if (!isVideo) return;
    root.dataset.mode = mode;
    clearTimeout(hideTimer);
    if (mode === "controls") {
      controls.start();
      poke();
    } else {
      controls.stop();
    }
  }

  // ---- showing an item ----
  let token = 0;
  // onShown: the picture (or its error) is in the frame.
  function show(i, onShown) {
    at = i;
    const item = items[i];
    title.textContent = item.title || "";
    controls?.setTitle(item.title || "");
    dots.forEach((d, n) => {
      d.classList.toggle("is-current", n === i);
      if (n === i) d.setAttribute("aria-current", "true");
      else d.removeAttribute("aria-current");
    });
    // Many dots: the row slides so the current one stays in view.
    if (items.length > MAX_DOTS) {
      const first = Math.min(
        Math.max(0, i - Math.floor(MAX_DOTS / 2)),
        items.length - MAX_DOTS,
      );
      dotsRow.style.transform = `translateX(${-first * DOT_STEP}px)`;
    }
    const run = ++token;
    zoom = { s: 1, x: 0, y: 0 };
    root.classList.remove("is-zoomed");
    if (isVideo) return showVideo(item, run);
    const img = el("img", "mv-image");
    img.alt = item.title || "";
    img.decoding = "async";
    img.draggable = false;
    // The previous picture stays until this one has loaded, then it fades in.
    img.addEventListener("load", () => {
      if (run !== token) return;
      frame.replaceChildren(img);
      requestAnimationFrame(() => img.classList.add("is-loaded"));
      onShown?.();
    });
    img.addEventListener("error", () => {
      if (run !== token) return;
      frame.replaceChildren(el("p", "mv-error", "This image couldn't load."));
      onShown?.();
    });
    img.src = item.image;
  }

  let starting = false;
  let poster = null;
  function setPoster(id) {
    root.classList.remove("is-ended");
    const [large, standard] = youTubeStills(id);
    poster.onload = () => {
      // YouTube's stand-in for a missing still is 120px wide.
      if (poster.naturalWidth <= 120 && poster.src === large)
        poster.src = standard;
    };
    poster.onerror = () => {
      if (poster.src === large) poster.src = standard;
    };
    poster.src = large;
  }
  function showVideo(item, run) {
    if (player) {
      setPoster(item.videoId);
      return player.load(item.videoId);
    }
    if (starting) return;
    starting = true;
    const host = el("div", "mv-video");
    poster = el("img", "mv-poster");
    poster.alt = "";
    poster.draggable = false;
    setPoster(item.videoId);
    // Covers YouTube's frame so every tap reaches this viewer, never YouTube.
    const shield = el("div", "mv-shield");
    frame.replaceChildren(host, poster, shield);
    createYouTubePlayer(host, item.videoId, {
      onState(playing, ended) {
        controls.setPlaying(playing);
        controls.showVolume();
        root.classList.toggle("is-ended", ended);
        if (ended) setMode("controls");
        if (playing) poke();
        else clearTimeout(hideTimer);
      },
    })
      .then((p) => {
        if (current?.root !== root) return p.destroy();
        player = p;
        // The item changed while the player was still loading.
        if (items[at].videoId !== item.videoId) player.load(items[at].videoId);
      })
      .catch(() => {
        if (current?.root === root)
          frame.replaceChildren(
            el("p", "mv-error", "This trailer couldn't be played."),
          );
      });
  }

  function go(i) {
    if (i < 0 || i >= items.length || i === at || sliding) return;
    if (isVideo) return show(i);
    slideTo(i, i > at ? 1 : -1);
  }

  // ---- pictures slide: the old one out one side, the new one in the other ----
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let sliding = false;
  function moveFrame(x, animate) {
    frame.style.transition = animate ? `transform ${SLIDE_MS}ms ease-out` : "";
    frame.style.transform = x ? `translateX(${x}px)` : "";
  }
  function slideTo(i, dir) {
    if (still.matches) {
      moveFrame(0, false);
      return show(i);
    }
    sliding = true;
    const w = stage.clientWidth;
    moveFrame(-dir * w, true);
    setTimeout(() => {
      frame.replaceChildren();
      moveFrame(dir * w, false);
      show(i, () => {
        // Start from the far side, then glide in.
        frame.getBoundingClientRect();
        moveFrame(0, true);
        setTimeout(() => (sliding = false), SLIDE_MS);
      });
    }, SLIDE_MS);
  }

  // ---- picture zoom: double tap or click, pinch, wheel; drag pans it ----
  let zoom = { s: 1, x: 0, y: 0 };
  function picture() {
    const img = frame.querySelector(".mv-image.is-loaded");
    return img?.naturalWidth ? img : null;
  }
  // Keeps the zoomed picture covering the screen wherever it fits.
  function clampZoom({ s, x, y }) {
    const img = picture();
    if (!img) return { s: 1, x: 0, y: 0 };
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const fit = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const mx = Math.max(0, (s * img.naturalWidth * fit - w) / 2);
    const my = Math.max(0, (s * img.naturalHeight * fit - h) / 2);
    return {
      s,
      x: Math.min(Math.max(x, -mx), mx),
      y: Math.min(Math.max(y, -my), my),
    };
  }
  function setZoom(z, animate) {
    zoom = z;
    root.classList.toggle("is-zoomed", z.s > 1);
    const img = picture();
    if (!img) return;
    img.style.transition = animate && !still.matches ? "" : "none";
    img.style.transform =
      z.s > 1 ? `translate(${z.x}px, ${z.y}px) scale(${z.s})` : "";
  }
  // Zooms to s, keeping the picture's point under (cx, cy) where it is.
  function zoomAround(s, cx, cy, animate, from = zoom, ax = cx, ay = cy) {
    s = Math.min(Math.max(s, 1), MAX_ZOOM);
    const r = frame.getBoundingClientRect();
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2;
    const k = s / from.s;
    setZoom(
      clampZoom({
        s,
        x: cx - ox - k * (ax - ox - from.x),
        y: cy - oy - k * (ay - oy - from.y),
      }),
      animate,
    );
  }
  function unzoom() {
    setZoom({ s: 1, x: 0, y: 0 }, true);
  }
  stage.addEventListener(
    "wheel",
    (e) => {
      if (isVideo || !picture()) return;
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 16 : 1;
      // A trackpad pinch arrives as the wheel with Ctrl held, in finer steps.
      const rate = e.ctrlKey ? 0.01 : 0.002;
      zoomAround(
        zoom.s * Math.exp(-e.deltaY * lines * rate),
        e.clientX,
        e.clientY,
        !e.ctrlKey,
      );
    },
    { passive: false },
  );

  // ---- taps (trailers); drags, pinches and double taps (pictures) ----
  const pointers = new Map();
  let press = null;
  let pinch = null;
  let lastTap = null;
  function twoFingers() {
    const [a, b] = [...pointers.values()];
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  }
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || sliding) return;
    if (isVideo) {
      press = { x: e.clientX, y: e.clientY, id: e.pointerId };
      return;
    }
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && picture()) {
      // A second finger: a pinch, so any swipe the first began is dropped.
      if (press && zoom.s === 1) moveFrame(0, true);
      press = null;
      lastTap = null;
      pinch = { ...twoFingers(), from: zoom };
    } else if (pointers.size === 1)
      press = { x: e.clientX, y: e.clientY, id: e.pointerId, from: zoom };
  });
  stage.addEventListener("pointermove", (e) => {
    if (isVideo || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size < 2) return;
      const now = twoFingers();
      zoomAround(
        (pinch.from.s * now.d) / pinch.d,
        now.cx,
        now.cy,
        false,
        pinch.from,
        pinch.cx,
        pinch.cy,
      );
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (Math.hypot(dx, dy) > 10) press.moved = true;
    if (zoom.s > 1) {
      const { from } = press;
      setZoom(clampZoom({ s: from.s, x: from.x + dx, y: from.y + dy }), false);
      return;
    }
    // Past the first or last picture it gives, but only a little.
    let x = dx;
    if ((x > 0 && at === 0) || (x < 0 && at === items.length - 1)) x /= 3;
    moveFrame(x, false);
  });
  stage.addEventListener("pointerup", (e) => {
    if (isVideo) {
      if (!press || press.id !== e.pointerId) return;
      const tap =
        Math.abs(e.clientX - press.x) < 10 &&
        Math.abs(e.clientY - press.y) < 10;
      press = null;
      if (tap)
        setMode(root.dataset.mode === "controls" ? "browse" : "controls");
      return;
    }
    if (!pointers.delete(e.pointerId)) return;
    if (pinch) {
      if (pointers.size) return;
      pinch = null;
      if (zoom.s < 1.05) unzoom();
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    const dx = e.clientX - press.x;
    const { moved } = press;
    press = null;
    if (!moved) {
      if (zoom.s === 1) moveFrame(0, true);
      const t = e.timeStamp;
      const double =
        lastTap &&
        t - lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
      lastTap = double ? null : { t, x: e.clientX, y: e.clientY };
      if (double && picture()) {
        if (zoom.s > 1) unzoom();
        else zoomAround(ZOOM_TO, e.clientX, e.clientY, true);
      }
      return;
    }
    lastTap = null;
    if (zoom.s > 1) return;
    const dir = dx < 0 ? 1 : -1;
    const next = at + dir;
    if (Math.abs(dx) > SWIPE && next >= 0 && next < items.length)
      slideTo(next, dir);
    else moveFrame(0, true);
  });
  stage.addEventListener("pointercancel", (e) => {
    press = null;
    if (isVideo) return;
    pointers.delete(e.pointerId);
    if (!pointers.size) pinch = null;
    if (zoom.s === 1) moveFrame(0, true);
  });
  // Moving the mouse or using a control keeps the controls up.
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") poke();
  });

  // ---- "Set as": a small menu, then a confirmation ----
  function buildSetAs() {
    const box = el("div", "mv-top-right");
    const btn = button("mv-close mv-set-as", "Set as", "setAs");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    const menu = el("div", "mv-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Set as");
    menu.hidden = true;
    menu.append(el("p", "mv-menu-label", "Set as…"));
    const entries = SET_AS.map(([kind, name, viewBox, paths]) => {
      const b = el("button", "mv-menu-item");
      b.type = "button";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", viewBox);
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", "mv-menu-icon");
      svg.innerHTML = paths;
      b.append(svg, el("span", "mv-menu-text", name));
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", () => ask(kind, name));
      menu.append(b);
      return b;
    });
    box.append(btn, menu);

    const overlay = el("div", "mv-alert-overlay");
    overlay.hidden = true;
    const card = el("div", "mv-alert");
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "mv-alert-title");
    card.setAttribute("aria-describedby", "mv-alert-text");
    const heading = el("h2", "mv-alert-title");
    heading.id = "mv-alert-title";
    const text = el("p", "mv-alert-text");
    text.id = "mv-alert-text";
    const error = el("p", "mv-alert-error", "Couldn't save. Try again.");
    error.hidden = true;
    const actions = el("div", "mv-alert-actions");
    const cancel = el("button", "mv-alert-btn", "Cancel");
    const confirm = el("button", "mv-alert-btn is-default", "Set");
    cancel.type = confirm.type = "button";
    actions.append(cancel, confirm);
    card.append(heading, text, error, actions);
    overlay.append(card);

    let asking = null;
    let saving = false;

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      entries[0].focus({ preventScroll: true });
    }
    function closeMenu(refocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (refocus) btn.focus({ preventScroll: true });
    }
    function ask(kind, name) {
      closeMenu(false);
      asking = { kind, item: items[at] };
      heading.textContent = `Set as ${name}?`;
      text.textContent = `This picture will replace the game's ${name.toLowerCase()}.`;
      error.hidden = true;
      overlay.hidden = false;
      confirm.focus({ preventScroll: true });
    }
    function dismiss() {
      if (saving) return;
      asking = null;
      overlay.hidden = true;
      btn.focus({ preventScroll: true });
    }
    async function save() {
      if (!asking || saving) return;
      saving = true;
      confirm.disabled = cancel.disabled = true;
      error.hidden = true;
      try {
        // On success the game page redraws its art, which closes the viewer.
        await onSetAs(asking.kind, asking.item);
        saving = false;
        dismiss();
      } catch {
        error.hidden = false;
      } finally {
        saving = false;
        confirm.disabled = cancel.disabled = false;
      }
    }

    btn.addEventListener("click", () =>
      menu.hidden ? openMenu() : closeMenu(true),
    );
    cancel.addEventListener("click", dismiss);
    confirm.addEventListener("click", save);
    // A tap anywhere outside the open menu only closes it.
    root.addEventListener(
      "pointerdown",
      (e) => {
        if (menu.hidden || box.contains(e.target)) return;
        e.stopPropagation();
        closeMenu(false);
      },
      true,
    );

    // Keys while the menu or the confirmation is up. True: handled here.
    function onKey(e) {
      if (!overlay.hidden) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        } else if (e.key === "Tab") {
          e.preventDefault();
          (document.activeElement === cancel ? confirm : cancel).focus();
        }
        return true;
      }
      if (menu.hidden) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const i = entries.indexOf(document.activeElement);
        const d = e.key === "ArrowDown" ? 1 : -1;
        entries[(i + d + entries.length) % entries.length].focus();
      } else if (e.key === "Tab") closeMenu(false);
      return true;
    }

    return { box, overlay, onKey };
  }

  // ---- keys (capture, ahead of the menu's own Escape) ----
  function onKey(e) {
    if (setAs?.onKey(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const inControls = isVideo && root.dataset.mode === "controls";
    if (!isVideo && picture() && ["+", "=", "-", "0"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const r = frame.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (e.key === "0") unzoom();
      else zoomAround(zoom.s * (e.key === "-" ? 1 / 1.5 : 1.5), cx, cy, true);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      e.stopPropagation();
      const d = e.key === "ArrowLeft" ? -1 : 1;
      if (inControls) {
        player?.skip(d * 10);
        poke();
      } else go(at + d);
      return;
    }
    if (e.key === " " && isVideo && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      e.stopPropagation();
      player?.toggle();
      if (inControls) poke();
      else setMode("controls");
    }
  }
  window.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", () => close());

  function close() {
    if (current?.root !== root) return;
    current = null;
    token++;
    clearTimeout(hideTimer);
    controls?.stop();
    window.removeEventListener("keydown", onKey, true);
    if (document.fullscreenElement === root) document.exitFullscreen?.();
    player?.destroy();
    root.remove();
    if (behind) behind.inert = false;
    opener?.focus({ preventScroll: true });
  }

  current = { root, close };
  if (behind) behind.inert = true;
  document.body.append(root);
  show(at);
  // The viewer itself, not the close button, so Space plays rather than closes.
  root.tabIndex = -1;
  root.focus({ preventScroll: true });
}
