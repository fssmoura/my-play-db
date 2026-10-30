# Frontend (the new app at `/`)

The new app: `public/index.html`, `public/js/`, `public/css/` and the patched
`public/vendor/liquidGL.js`. What it is and how it fits together is in
[README.md](../README.md); the look and the design rules are in
[design.md](design.md); the old tabbed app at `/lab/` is in [lab.md](lab.md).
This doc keeps only what the code can't say - read it before changing any of
those files.

## Principles

- **Simple and practical now, modular enough to be redesigned later.** The look
  will be rebuilt by hand from a real design, so keep behaviour independent of
  presentation - a different UI, on different pages, should be able to reuse
  the logic without rewriting it.
- **Functional still has to be usable:** wireframe means unstyled, not awkward.
- **State modules have no DOM.** `search-state.js`, `game-state.js`,
  `filter-state.js`, `search-session.js` and `game-art.js` hold state and emit
  events; pages and controls only render state and report clicks. This is what
  makes the principle above possible.
- **Behaviour in JS, looks in CSS.** JS sets only CSS variables (the springs
  drive things like `--search-t` and `--game-t`) and animated sizes (the By
  Type submenu's height) inline; every other look lives in CSS.

## Copies of the lab's code

`search.js`, `ranking.js`, `sgdb.js`, `sgdb-match.js`, `games-cache.js` and
`api.js` are copies of the lab's, each with a header saying where it came from.
They are independent on purpose, so work on the app can never change the lab:
never import across, and fix a bug in both. `sgdb.js` is the one that behaves
differently - see [Game page art](#game-page-art).

The shared auth modules (`config.js`, `supabase.js`, `session.js`) and
`dev-reload.js` are the exception: one copy in `public/js/`, which the lab
imports by absolute URL (`/js/...`) so the browser loads it once.

## liquidGL

The glass is [liquidGL](https://github.com/naughtyduk/liquidGL) (npm
`liquid-gl` 3.0.0, MIT, licence beside the file). `menu.js` loads it with a
dynamic `import()`; if that fails the controls are plain and still work.

**The vendored copy is patched - never swap it for a CDN or npm copy, and
re-apply all six patches if upgrading.** What each patch does and why is in the
file's header; each is marked `my-play-db patch` in both shaders (WebGL and
WebGPU) and in the JavaScript that feeds them (the blur's snapshot code and the
rim light's `dpr` uniform). What the header doesn't say:

- Before the vertical-bend patch, the bend was about 6x too strong on the glass
  test page and looked like a flat smear.
- Upstream's drifting specular glows (removed by the rim-light patch) were very
  visible on a black page.
- For the `blur` patch, canvas `filter: blur()` was tried first: it is silently
  ignored on the tall snapshot canvas, and missing in Safari.
- The drop shadow is liquidGL's own, unpatched.

**Making a new lens match.** Every lens uses the one `GLASS_CONFIG` in
`menu.js` (one exception: the By Type submenu's lens overrides `tint`); the numbers live only there, the approved look in
[design.md](design.md#glass). `bevelWidth` is a fraction of the lens's shorter
side, so the same value is a fine rim on a card and a useless one on the small
pill - it was tuned on a card `BEVEL_REFERENCE_PX` wide and `fitBevel()`
rescales it per lens and on resize. Values tuned on a different-sized lens need
the same treatment. To tune live, change `false` to `true` in `menu.js`'s `HELPER = IS_LOCAL && false` (localhost
only; off by default because its panel covers the page). Judge the glass over
real, colourful content: on a black page there is nothing to bend, bevel or
specular can draw a dark ragged outline over bright content, and `bevelWidth`
on its own can darken a band inside the rim.

**Quirks** (each has already caused a bug):

- It writes inline `pointer-events: none` and `opacity` on its targets, so
  `menu.css` gives `pointer-events` back to everything clickable, or nothing
  can be clicked.
- It draws a lens whenever the element has a box, so a closed panel is
  `display: none` - no scale/fade animation, which would also misalign the
  lens.
- It forces `transition: none` while revealing the lens (about 1s), then
  restores the element's own transition, so animated lenses are driven by a JS
  spring writing a CSS variable.
- It sets `backdrop-filter: none` inline, so any extra blur goes on a
  pseudo-element inside the lens. (The By Type submenu does this: the lens tint
  is drawn under all page text, so without it the rows behind show through
  sharp.)
- It reads the element's rect, so a lens moves by `top`/`bottom`/size, never
  `transform`.
- No CSS layers behind or on a lens (fill, rim, blur, isolation) - they
  glitch next to it.

### Glass refresh

liquidGL photographs the page and only retakes the photo when the page's size
changes, so anything else that changes what is under the glass needs
`refreshGlass()` (why, and the per-layer detail, are in `glass-refresh.js`).

- A capture measured about 10ms at 60 cards.
- **Never recapture every frame.** Back-to-back captures caused the game page's
  scroll lag; inner scrollers go through the throttled
  `refreshGlassWhileScrolling()`.
- Known limit: once real content scrolls under a lens, it stays stale until
  scrolling pauses.
- The overlay scroll indicator is `data-liquid-ignore`, so it stays out of the
  snapshot.

## Images

**Every cover host must either send CORS or have a same-origin `/img` rewrite
in `vercel.json`, or its images show grey under the glass** (liquidGL can't
read them into its snapshot). IGDB sends CORS; PlayStation
(`image.api.playstation.com`) and SteamGridDB (`cdn2.steamgriddb.com`) are
rewritten. `image-url.js` loads every image with CORS first, retries once
without, and logs one `console.warn` per host that needed the retry.

- Proxied images count against Vercel bandwidth. PlayStation covers are 1440px
  PNGs, hence the `?w=` resize parameter.
- Under `vercel dev` the origin's own `Cache-Control` comes through rather than
  ours, and `vercel dev` must be restarted after editing `vercel.json`. A UTF-8
  BOM in that file stops it starting with "Couldn't parse JSON".

**Fixing a grey card under the glass:**

1. Look for the per-host warning in the console, or check the card's `img`:
   `crossOrigin` null means it fell back to no-CORS.
2. Check the host with `curl -I -H "Origin: http://localhost:3000" <image url>`.
   No `Access-Control-Allow-Origin` means it needs a rewrite.
3. Add `/img/<name>/:path*` -> `https://<host>/:path*` to `vercel.json` and the
   host to `PROXIED_HOSTS` in `image-url.js`. **Never a rewrite whose host
   comes from the request** - that would be an open proxy.
4. Restart `vercel dev` and confirm `getImageData` on a canvas with that image
   doesn't throw.

For large originals, use the host's own resize parameter if it has one.

## Search

- **Cache first, IGDB merged over it.** The `games` cache answers faster than
  IGDB, so it is painted first. A game already on screen keeps ranking by the
  copy it was first shown with (`rankBasis`), so cards never reshuffle when
  IGDB's newer popularity arrives. Why the cache stores the ranking fields:
  [database.md](database.md#games-is-a-cache-not-a-list-of-games-owned).
- **A held game keeps its cached cover** (the first `cover` entry is the
  owner's choice) while IGDB's copy wins for everything else.
- Skeletons already on screen are kept and cards are reconciled by id, so the
  shimmer doesn't restart and images aren't rebuilt on each keystroke.
- **The filter rules** (what a filter set before or after a search does, In
  Library not wired yet) are in
  [design.md](design.md#decisions-so-far); the implementation is the header of
  `search-session.js`.
- After a search finishes, the type counts describe the current results, so a
  filtered search shows 0 for every unselected type. That is deliberate, not a
  bug.

## Game page

- **The sheet is `overflow: clip`, not `hidden`,** or the sticky header
  breaks.
- **Swipe down only when the sheet is scrolled to the top and moving down,**
  so it never fights scrolling. Images are `draggable=false` so a press starts
  the swipe, not an image drag.
- The banner fades with a mask, not a black overlay, so there is no band on
  bright banners.
- The bottom bar's spring variables live on the stage, not the bar - a
  declaration on the bar would override the inherited value.

### Game page art

`game-art.js` decides what to show on open. Matching is strict - see
[api.md](api.md#matching-igdb-games-to-sgdb-entries). The art rule is in
[database.md](database.md#images-cover-banner-logo-screenshots) and what
`sgdb_id` NULL / 0 / above 0 mean in [database.md](database.md#sgdb_id).

- **The app's `sgdb.js` throws on any failure other than a 404,** where the
  lab's swallows it. A failed lookup must write nothing; treated as "no match"
  it would store `sgdb_id = 0`, which is never retried.

## Address and history

The rules (one history entry per search or game, never a stray one; a game's
address is `/?game=<id>` alone) are in [design.md](design.md#decisions-so-far).
How they are kept, including links loaded straight into search or onto a game,
is commented at the top of `url-state.js` and `app-shell.js`.

## Startup performance

- `index.html` `modulepreload`s the critical-path modules - keep that list in
  step with the import graph. Measured at 4x CPU and 40ms latency, the
  preloads took mounting from 498ms to 417ms.
- **liquidGL is deliberately not preloaded:** its 311KB competed with the main
  thread and made startup slower.
- Not done: long cache headers for `/js` and `/css`. There is no file hashing,
  so a long max-age would serve stale code.
