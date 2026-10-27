// A thin overlay scroll indicator in place of a native scrollbar, so the page
// never changes width when content starts to scroll. Behaviour only; the look
// lives in css/overlay-scroll.css. Not specific to any page.
//
//   createOverlayScroll({ scroller, content, host, top, bottom })
//
// - scroller: the scrolling element, or omitted for the page itself. Its native
//   scrollbar must already be hidden (see `.overlay-scroll-host` in the css).
// - content: element whose size changes when the scrollable length changes
//   (observed, coalesced to one update per frame).
// - host: where the indicator is appended (default: document.body for the
//   page, the scroller's parent for an element - it must be positioned).
// - top / bottom: space kept free at either end of the track, in px.
//
// Returns { update, destroy }. Decoration only, so it is aria-hidden.

const IDLE_MS = 1000;
const MIN_THUMB = 36;

export function createOverlayScroll({
  scroller = null,
  content = null,
  host = null,
  top = 0,
  bottom = 0,
} = {}) {
  const page = scroller === null;
  const el = page ? document.scrollingElement : scroller;
  const scrollTarget = page ? window : scroller;
  const parent = host ?? (page ? document.body : scroller.parentElement);

  const track = document.createElement("div");
  track.className = `overlay-scroll ${page ? "is-page" : "is-element"}`;
  track.setAttribute("aria-hidden", "true");
  // Keeps liquidGL's snapshot from capturing it.
  track.setAttribute("data-liquid-ignore", "");
  track.hidden = true;
  const thumb = document.createElement("div");
  thumb.className = "overlay-scroll-thumb";
  track.append(thumb);
  parent.append(track);

  let metrics = null;
  let frame = 0;
  let idleTimer = 0;
  let dragging = false;
  let hovering = false;

  function measure() {
    const client = page ? window.innerHeight : el.clientHeight;
    const total = el.scrollHeight;
    // For an element the track sits over the scroller; offsets are relative to
    // the host.
    const start = page ? top : el.offsetTop + top;
    const length = client - top - bottom;
    return { client, total, start, length };
  }

  function update() {
    frame = 0;
    const m = measure();
    const scrollable = m.total - m.client > 1 && m.length > MIN_THUMB;
    track.hidden = !scrollable;
    if (!scrollable) {
      metrics = null;
      return;
    }
    const size = Math.max(MIN_THUMB, (m.length * m.client) / m.total);
    const ratio = el.scrollTop / (m.total - m.client);
    const travel = m.length - size;
    metrics = { ...m, size, travel };
    track.style.setProperty("--os-top", `${m.start}px`);
    track.style.setProperty("--os-length", `${m.length}px`);
    track.style.setProperty("--os-size", `${size}px`);
    track.style.setProperty(
      "--os-y",
      `${Math.min(Math.max(ratio, 0), 1) * travel}px`,
    );
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function hideSoon() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!dragging && !hovering) track.classList.remove("is-active");
    }, IDLE_MS);
  }

  function onScroll() {
    schedule();
    track.classList.add("is-active");
    hideSoon();
  }

  let startY = 0;
  let startScroll = 0;
  function onDown(event) {
    if (!metrics) return;
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startScroll = el.scrollTop;
    thumb.setPointerCapture(event.pointerId);
    track.classList.add("is-active", "is-dragging");
  }
  function onMove(event) {
    if (!dragging || !metrics || metrics.travel <= 0) return;
    const range = metrics.total - metrics.client;
    el.scrollTop =
      startScroll + ((event.clientY - startY) * range) / metrics.travel;
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("is-dragging");
    hideSoon();
  }
  const onEnter = () => {
    hovering = true;
    track.classList.add("is-active");
  };
  const onLeave = () => {
    hovering = false;
    hideSoon();
  };

  scrollTarget.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  thumb.addEventListener("pointerdown", onDown);
  thumb.addEventListener("pointermove", onMove);
  thumb.addEventListener("pointerup", onUp);
  thumb.addEventListener("pointercancel", onUp);
  track.addEventListener("pointerenter", onEnter);
  track.addEventListener("pointerleave", onLeave);

  const observer = new ResizeObserver(schedule);
  if (content) observer.observe(content);
  if (!page) observer.observe(scroller);
  schedule();

  return {
    update: schedule,
    destroy() {
      cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
      observer.disconnect();
      scrollTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
      track.remove();
    },
  };
}
