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
