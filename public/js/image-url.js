// Image URLs for display, shared by the results grid and the game page. No DOM
// state; stored URLs are never changed, only what the browser is asked for.
//
// liquidGL snapshots the page, so every image must be readable by it: IGDB
// sends CORS headers; PlayStation and SteamGridDB don't, so they are shown
// through same-origin rewrites (vercel.json, /img/*). Any other host that only
// loads without CORS shows grey under the glass and logs one warning.

const PROXIED_HOSTS = {
  "image.api.playstation.com": "/img/psn",
  "cdn2.steamgriddb.com": "/img/sgdb",
};

// Per use: IGDB's size segment and Sony's ?w= width. SteamGridDB art is served
// as stored.
const SIZES = {
  cover: { igdb: "t_cover_big_2x", psn: "528" },
  banner: { igdb: "t_1080p", psn: "1320" },
  logo: { igdb: "t_1080p", psn: "528" },
};

export function displayImageUrl(url, kind = "cover") {
  if (!url) return "";
  const size = SIZES[kind] ?? SIZES.cover;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "images.igdb.com") {
      return url.replace(/\/t_[a-z0-9_]+\//i, `/${size.igdb}/`);
    }
    const prefix = PROXIED_HOSTS[parsed.hostname];
    if (prefix) {
      if (parsed.hostname === "image.api.playstation.com") {
        parsed.searchParams.set("w", size.psn);
      }
      return prefix + parsed.pathname + parsed.search;
    }
    return url;
  } catch {
    return url;
  }
}

const warnedHosts = new Set();
function warnNoCors(url) {
  let host = "";
  try {
    host = new URL(url, location.href).hostname;
  } catch {
    return;
  }
  if (!host || warnedHosts.has(host)) return;
  warnedHosts.add(host);
  console.warn(
    `Image host ${host} sends no CORS headers: add a same-origin /img rewrite for it in vercel.json, or it shows grey under the glass.`,
  );
}

/**
 * Loads `src` into `img` so liquidGL can read it: crossOrigin first, src last;
 * hosts without CORS fail that way, so one retry without it (and a warning).
 * onLoad() / onError() report the outcome (onError only after the retry).
 */
export function loadImageForGlass(img, src, { onLoad, onError } = {}) {
  let retried = false;
  img.addEventListener("load", () => {
    if (retried) warnNoCors(src);
    onLoad?.();
  });
  img.addEventListener("error", () => {
    if (!retried && img.crossOrigin) {
      retried = true;
      img.removeAttribute("crossorigin");
      img.src = src;
      return;
    }
    onError?.();
  });
  img.crossOrigin = "anonymous";
  img.src = src;
}

// Starts downloading an image ahead of use, in the same CORS mode as
// loadImageForGlass so the later load reuses it. Held until it settles so it
// isn't dropped mid-download.
const warming = new Set();
export function preloadImage(url, kind) {
  const src = displayImageUrl(url, kind);
  if (!src) return;
  const img = new Image();
  warming.add(img);
  const done = () => warming.delete(img);
  img.addEventListener("load", done);
  img.addEventListener("error", done);
  img.crossOrigin = "anonymous";
  img.src = src;
}
