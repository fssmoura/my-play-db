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
  `filter-state.js`, `search-session.js`, `library.js` and `game-art.js` hold
  state and emit
  events; pages and controls only render state and report clicks. This is what
  makes the principle above possible.
- **Behaviour in JS, looks in CSS.** JS sets only CSS variables (the springs
  drive things like `--search-t` and `--game-t`) and animated sizes (the By
  Type submenu's height) inline; every other look lives in CSS.

## Copies of the lab's code

`search.js`, `ranking.js`, `sgdb.js`, `sgdb-match.js`, `games-cache.js` and
`api.js` are copies of the lab's (the lab's `search.js` has since been
removed), each with a header saying where it came from.
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
re-apply all seven patches if upgrading.** What each patch does and why is in
the file's header; each is marked `my-play-db patch` in both shaders (WebGL and
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
  `transform`. Its photo also ignores transforms on what is under a lens, so
  anything that moves under glass (the Customize full-screen image) is sized
  and placed with `left`/`top`/`width`/`height`.
- No CSS layers behind or on a lens (fill, rim, blur, isolation) - they
  glitch next to it.
- It draws each lens on a canvas inside the lens's nearest fixed ancestor,
  just above that ancestor's own background and below its contents. A new
  fixed screen with a background (the Customize drawer) gets glass by making
  the screen itself the fixed box that carries the background, with the
  usual `zIndex: 1`. A background on a separate box painted above the canvas
  hides the glass silently, and so does content of the same box scrolling
  under a lens - the Customize tabs have a fixed box of their own
  (`.customize-bar`) above the drawer, as does the full-screen image's X.
  Upstream also drew the glass of every lower box under its lenses, even when
  covered (patched: see the file header).
- Its snapshot leaves out a lens's own contents but not text merely placed
  over it, so such text (the Customize tab labels over their pill) must carry
  `data-liquid-ignore`, or the glass shows it as a blurred glow.

### Glass refresh

liquidGL photographs the page and only retakes the photo when the page's size
changes, so anything else that changes what is under the glass needs
`refreshGlass()` (why, and the per-layer detail, are in `glass-refresh.js`).

- A capture measured about 10ms at 60 cards.
- The photo is taken at half a pixel per CSS px (`resolution` in menu.js):
  the blur hides finer detail, and at the original 2 every photo was about
  16 times the work.
- **Never recapture while scrolling.** Back-to-back captures made the game
  page's scroll lag, and throttled ones still lagged behind the content.
  Scrolling is followed by sliding the photo instead: liquidGL places it by
  the photographed element's position every frame, which is why the page's
  own scroll is free.
- Content scrolling inside its own box (the game page) gets the same by
  pointing the glass at an element that moves with it
  (`glassPhotographs()`). Anything that moves differently from that element
  (the pinned banner, image rows scrolling sideways) is left out of the photo,
  photographed on its own, and drawn over the photo where it is now, every
  frame, under the lenses only (patched hook: see the file header). Measured
  about 0.5ms a frame.
- Known limit: the Customize drawer still re-photographs, so its images stop
  above its tabs instead of scrolling under them.
- A lens can photograph one element instead of the page (`snapshot` in its
  `liquidGL()` call). The Customize full-screen X photographs only the viewer,
  so its glass shows just the image and retaking it while the image moves is
  cheap (`refreshGlassOf()`).
- **A capture walks every element it doesn't ignore, hidden under something
  or not.** The Customize panes are `data-liquid-ignore` (nothing in them is
  under glass), and the drawer retakes only its own layers'
  (`refreshGlassWithin()`), never on a tab change. Measured with Hades open:
  14 captures of ~27ms each with the panes photographed, 3 of ~7ms without.
  The page's own glass,
  covered by the drawer, keeps its photo of the page for when it closes.
- **The game page does the same for the results behind it.** While the sheet
  is up, the content is pinned in place (`position: fixed` at minus its
  scroll), so the document is only a screen tall, and is
  `data-liquid-ignore`. The photo's size follows the document's height, so on
  a phone a long results list made every photo under the sheet slow. On open,
  `blankGlass()` swaps the photo for the plain background at once, so no
  reflections of the list linger while the first real photo is taken. Closing
  restores the scroll position before the glass retakes the list.
- The overlay scroll indicator is `data-liquid-ignore`, so it stays out of the
  snapshot.

**The Customize grids on a phone.** Lagging and heating came from work
nobody could see, so only what is near the view does anything: a tile's
shimmer runs only while near the view, and is a band moved by the GPU rather
than a repainted background; animated thumbnails play only on screen, a few at
a time, and are let go once scrolled away (each held video keeps a decoder
busy).

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

- **One IGDB request is the whole feature.** `igdb.search` returns the display
  fields as well as the ranking ones, so paging and filtering need no network.
  An earlier version used three actions (candidate pool, "suggest" fast path,
  per-page hydrate), which re-fetched games it already had and drew the page
  in four stages. Adding a second IGDB request repeats that mistake.
- A cache lookup for an abandoned query lands fast and would overwrite a newer
  search without the sequence guard in `search.js`.
- **Cache first, IGDB merged over it.** The `games` cache answers faster than
  IGDB, so it is painted first. A game already on screen keeps ranking by the
  copy it was first shown with (`rankBasis`), so cards never reshuffle when
  IGDB's newer popularity arrives. Why the cache stores the ranking fields:
  [database.md](database.md#games-is-a-cache-not-a-list-of-games-owned).
- **Every result shows the owner's chosen cover**, however it was found. The
  head start only holds games whose name matched the query, and IGDB also
  matches nicknames ("gta" finds Grand Theft Auto VI), so after IGDB answers,
  the remaining results' covers are looked up by id (`storedCovers()`). IGDB's
  copy wins for everything else.
- Skeletons already on screen are kept and cards are reconciled by id, so the
  shimmer doesn't restart and images aren't rebuilt on each keystroke.
- **The filter rules** (what a filter set before or after a search does,
  including In Library) are in
  [design.md](design.md#decisions-so-far); the implementation is the header of
  `search-session.js`.
- **In Library never asks IGDB.** `library.js` loads the whole library from
  `player_games` (once a minute at most, on entering search) and searches it
  locally with the same ranking. It skips `platforms` and `release_dates`,
  which made up most of the ~1 MB download and that cards don't need.
- **Each app load syncs the stores** (`library.sync()`, the same endpoint as
  the lab, so its 15-minute rule stops repeats), silently, then reloads the
  library.
- **Popular right now** (nothing typed) is built by `igdb.popular`, once per
  day, and the browser keeps that day's copy in `localStorage`, so opening
  search shows it instantly. The day turns over at 01:00 UTC, after IGDB's
  daily recalculation. How it's ranked: [api.md](api.md#popular). The copy
  holds IGDB's covers only; the owner's chosen covers are looked up each time
  it shows, since a saved copy kept a cover changed on another device out
  until the next day.
- **Its entrance is kept smooth on purpose:** it paints only after the search
  bar has opened (~300ms) and its first 20 covers are decoded (2s at most,
  warmed from home on idle), and no glass snapshot (`refreshGlass`) is taken
  until the staggered slide-in ends. Each of those, happening mid-animation,
  made it stutter.
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
- **Platform icons** (`game-info.js`) are cropped to their drawing: each
  `viewBox` is the path's real bounds, measured with `getBBox()` in the
  browser (the `svg-path-bounds` package gave wrong ones), so a common height
  makes them match. Logos that still look too big or small get a `scale`.

### Scrolling, once the page has content

The scroll behaviour was first built against a temporary filler
(`.game-sheet-body { min-height: 250dvh }`, added in 1dee22d, removed in
1404f76); a game with no trailers or images is still about one screen tall,
so put it back locally to test scrolling on one.
What depends on the sheet being taller than the screen:

- **One scroller for everything** (`.game-scroll`): an 85px spacer, then the
  sheet. Scrolling first lifts the sheet to the top of the viewport, then
  scrolls its content. Content goes inside `.game-sheet-body`, never in a
  scroller of its own, or the rise, the indicator and the toolbar all stop
  seeing it.
- **Sticky header:** `.game-head` (banner and logo) pins at the top, and
  content disappears under the banner's black. Content must stay below the
  head (`z-index` under 1), and the sheet must stay `overflow: clip`.
- **Edge stroke** (`.game-sheet::after`) covers only the first screenful
  (`100dvh - 85px`), sized to the Figma frame; it is not meant to run the
  sheet's full length.
- **Scroll indicator** (`overlay-scroll.js`) starts below the banner
  (`trackTop()`) and follows content height on its own (ResizeObserver).
- **Bottom toolbar** goes compact after scrolling, and expands only at the top
  or on tap (`game.reportScroll` -> `bottom-bar.js`). `.game-sheet-body`'s
  bottom padding keeps it off the last content.
- **Swipe down to close** only starts when the scroller is at the top, and
  gives way to a mostly sideways move (the Trailers and Images rows).
- **Glass:** scrolling during the rise retakes the top bar's glass (throttled);
  past it, nothing under the lenses changes, so it doesn't. Content that
  arrives or changes height after opening doesn't change the page's size, so
  liquidGL won't notice: call `refreshGlass()` once it settles, as the banner
  does (`settle()` in `game-page.js`).
- **Loading:** `.game-sheet-body` is hidden while the sheet shimmers; new
  content appears with the rest when `finishLoading()` runs.

### Trailers and Images

- **Trailers play through YouTube's IFrame API** with its controls off; ours
  are drawn over it. A transparent layer covers the iframe so taps reach the
  viewer, never YouTube (which would take them and show its own UI).
- **YouTube still draws its title, logo and "More videos"** on load and pause,
  whatever the player settings, pinned to the iframe's edges. The iframe is
  twice the frame's height and centred, so those land in black bands that the
  frame cuts off while the video itself stays fully in view. At the end the
  trailer's still covers YouTube's suggestions. YouTube's play/pause circle
  still flashes mid-frame as a video starts; the owner prefers that to
  holding the still over the first moment.
- **Phones only autoplay muted videos**, so on touch screens (no hover) a
  trailer always starts muted; the volume button turns the sound on. On a
  computer it starts with sound, and if the browser refuses, it is started
  muted after 1.5s.
- Card stills come from `i.ytimg.com` (`maxresdefault`, falling back to
  `hqdefault` on a 404 or YouTube's 120px stand-in). It sends CORS headers, so
  the stills are readable by the glass like IGDB's.
- The viewer and the all-cards page sit above everything (z-index 400+),
  outside the sheet, and take Escape first (capture listener) so it doesn't
  also close the game. Closing or switching the game closes them.

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
