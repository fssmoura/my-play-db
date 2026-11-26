// The game page's Achievements section: one card for the game, every store's
// list combined as on the achievement pages (loadGameAchievements in
// achievements-data.js), so the same game on two stores is still one card.
// It shows progress (earned of total) and, when the list has trophy grades,
// how many of each are unlocked.
//
//   achievementsSkeleton() -> element (stands in while the lists load)
//   achievementsSection(result, { onOpen }) -> element or null

const NS = "http://www.w3.org/2000/svg";
const CHEVRON = '<path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/>';

const TIERS = ["platinum", "gold", "silver", "bronze"];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function heading(onOpen) {
  const head = el("h2", "media-head");
  const title = el("button", "media-head-button");
  title.type = "button";
  title.setAttribute("aria-label", "All achievements");
  if (onOpen) title.addEventListener("click", () => onOpen(title));
  else title.disabled = true;
  title.append(el("span", "media-head-text", "Achievements"));
  const chevron = document.createElementNS(NS, "svg");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("aria-hidden", "true");
  chevron.setAttribute("fill", "currentColor");
  chevron.setAttribute("class", "media-head-chevron");
  chevron.innerHTML = CHEVRON;
  title.append(chevron);
  head.append(title);
  return head;
}

function buildCard({ total, earned, tiers }) {
  const box = el("div", tiers ? "ach-card" : "ach-card is-plain");
  const percent = Math.floor((earned / total) * 100);
  const stat = (value, name) => {
    const s = el("div", "ach-stat");
    s.append(el("span", "ach-stat-value", String(value)), el("span", "", name));
    return s;
  };
  // The ring: a track and an arc starting at the top.
  const ring = el("div", "ach-ring");
  ring.setAttribute("role", "progressbar");
  ring.setAttribute("aria-valuemin", "0");
  ring.setAttribute("aria-valuemax", "100");
  ring.setAttribute("aria-valuenow", String(percent));
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  for (const cls of ["ach-ring-track", "ach-ring-arc"]) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    c.setAttribute("r", "46");
    c.setAttribute("class", cls);
    if (cls === "ach-ring-arc") {
      c.setAttribute("pathLength", "100");
      c.setAttribute("stroke-dasharray", `${Math.max(percent, 1)} 100`);
    }
    svg.append(c);
  }
  ring.append(svg, el("span", "ach-ring-text", `${percent}%`));
  const top = el("div", "ach-top");
  top.append(stat(earned, "Earned"), ring, stat(total, "Available"));
  box.append(top);
  if (tiers) {
    const grades = el("div", "ach-grades");
    for (const tier of TIERS) {
      const grade = el("div", "ach-grade");
      const img = document.createElement("img");
      img.src = `/trophies/${tier}.png`;
      img.alt = tier;
      img.draggable = false;
      grade.append(img, el("span", "ach-grade-count", String(tiers[tier])));
      grades.append(grade);
    }
    box.append(grades);
  }
  return box;
}

// The heading and a shimmering card the size of a real one.
export function achievementsSkeleton() {
  const wrap = el("section", "ach-section is-skeleton");
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(heading(null), el("div", "ach-card is-skeleton"));
  return wrap;
}

// onOpen(opener): the title or the card was chosen (opens the achievement
// pages).
export function achievementsSection(result, { onOpen } = {}) {
  if (!result?.total) return null;
  const items = result.groups.flatMap((g) => g.items);
  const tiers = items.some((i) => i.tier)
    ? Object.fromEntries(
        TIERS.map((t) => [
          t,
          items.filter((i) => i.tier === t && i.earned).length,
        ]),
      )
    : null;
  const wrap = el("section", "ach-section");
  wrap.append(heading(onOpen));
  const box = buildCard({
    total: result.total,
    earned: result.unlocked,
    tiers,
  });
  // The whole card is a button, though it holds blocks (a <button> can't).
  box.setAttribute("role", "button");
  box.tabIndex = 0;
  box.setAttribute("aria-label", "All achievements");
  box.addEventListener("click", () => onOpen?.(box));
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpen?.(box);
  });
  wrap.append(box);
  return wrap;
}
