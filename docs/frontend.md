# Frontend

Structure of the lab SPA (`public/lab/`, served at `/lab/`) and the styling rules.
Most of this doc describes the lab at `/lab/`; the sections marked "(not part of
the lab)" just below cover the new app at `/` (sign-in screen and glass menu).
Read this before changing anything under `public/`.

`public/lab/` is a vanilla ES-module SPA. No bundler, no framework, no build step -
the browser loads the files as written, so editing them is immediate.

The lab has four tabs, shown only to a signed-in user: **Connections**, **API console**,
**Search**, **Game**. Sign-in is not part of the lab - it is the app's single sign-in at `/`
(see [auth.md](auth.md#gate-1---who-can-sign-in)). On boot, and whenever the session
disappears, the lab redirects to `/?next=<its own path + query>`; "Sign out" signs out and
goes to `/`. The lab header has a plain "Back to app" link to `/`.

**The sign-in screen (not part of the lab)** is styled in the Apple design language (single 360px column, 50px rounded fields and buttons, persistent field labels, inline errors in plain words, in-button progress, Google's dark-theme button with the multicolour G on a white chip). The rules and reasons are in [design.md](design.md); it uses the palette in `public/css/tokens.css`, with `sign-in.js` handling validation, the busy state and friendly error messages.

**The app menu (not part of the lab).** The main app page at `/` shows a
top-right "liquid glass" pill menu when signed in (never on the sign-in
screen): `public/js/menu.js` (`PILL_ITEMS` for the pill's buttons - Search, Profile (does nothing yet) and More - and `MENU_ITEMS` for the pull-down that More opens) and `public/css/menu.css`. The pull-down has two entries: the flask icon + "Switch Environment" linking to `/lab/`, and a red "Sign Out" (Apple's systemRed `--destructive` in `tokens.css`, a deliberate exception to the palette, for critical actions only) that signs out via `/js/session.js` and lands on `/`. Entries are data (`href` or `action`, plus `destructive` and `separatorBefore`); Sign Out sits in its own group under a thin divider. The pill is fixed 25px from the top and right; 44px tall (HIG minimum target),
22px radius (true half-height), 4px side padding, no CSS fill/rim/blur/shadow of its own (liquidGL draws all of it; the only CSS extra is a faint dark halo on icons and labels). Inside, the three buttons (Search, Profile, More) are 44x44 hit areas edge to edge, each with a 20px light-gray icon. Pull-down rows are 36px with a mouse and 44px on touch (`pointer: coarse`); their hover/focus highlight is a full capsule, and the panel radius is concentric with it (row radius + 6px padding: 24px, 28px on touch). The glass is drawn by
[liquidGL](https://github.com/naughtyduk/liquidGL) (npm `liquid-gl` 3.0.0, MIT, no dependencies; WebGPU, then WebGL, then a CSS fallback automatically), served from `public/vendor/liquidGL.js` (licence beside it) and loaded by `menu.js` with a dynamic `import()`. **That copy is patched:** upstream measures refraction as a fraction of the whole page snapshot, so on a long scrolling page the vertical bend grew with page length (about 6x too strong on the glass test page) and the glass looked like a flat smear. The one-line patch, in both shaders and marked `my-play-db patch`, measures the vertical bend against the page width too. A second patch adds a thin white rim light when `specular` is on (a fixed 1.5 CSS px wide on every lens, so the pill and the bigger pull-down match - it used to scale with lens size) and removes upstream's specular, two faint glows that drift around inside the lens (very visible on a black page), and a third makes `frost` a smooth blur instead of grainy random sampling. The drop shadow is liquidGL's own (`shadow: true`), unpatched - a stronger one was tried and rejected as too prominent. A fourth patch paints the tint over the glass (normal blend) instead of multiplying, so a grey tint actually looks grey - upstream's multiply can only darken. A fifth adds a `blur` option (CSS px): the snapshot is blurred once before upload with a downsample/upsample chain (the "dual filter" blur games use), giving a smooth blur. Use it instead of `frost`, which scatters a few samples per pixel and looks grainy or doubled at any real strength; canvas `filter: blur()` was tried first and is silently ignored on the tall snapshot canvas (and missing in Safari). A sixth adds dimming: the glass always darkens what shows through by 30% (keeping its colour), and by up to a further 40% where the background is bright, so white text stays readable on anything. Re-apply all six if liquidGL is ever upgraded. It is called on the fixed `#app-menu` pill. Its settings live in one `GLASS_CONFIG` object in `menu.js` (Figma dispersion -> `aberration`, frost -> `frost`). **To tune the look:** set `HELPER = true` in `menu.js` (localhost only) to load liquidGL's helper GUI (`liquidGL-helper.js`) with live sliders; copy the values you like back into `GLASS_CONFIG`. It is off by default and never loaded in production. If the library fails to load, the pill is plain (no fill) and the buttons still work. **Search pill:** clicking Search splits a second glass pill (`#app-search`, a third liquidGL lens, same `GLASS_CONFIG`, `zIndex` 2) off the left end of the main pill. It holds the search icon and a text field (focused at once, placeholder "Search", feeds the search state - see the flow below; native search-field chrome hidden; typed text is discarded when the pill closes). The main pill shrinks to Profile and More (the Search button lives in a `.menu-slot` that closes to 0 width); the two pills sit in `.menu-bar`, right-anchored, 8px apart. The whole morph is one number, `--search-t` (0 closed, 1 open), set on `#app-menu-stage` by a small spring in `wireSearch()` (`menu.js`; about 300ms, slight overshoot, reverses smoothly mid-flight) and turned into widths by `menu.css` - so the look can be redesigned without touching the logic. It is a JS-driven spring rather than a CSS transition because liquidGL forces `transition: none` on its lenses. Its text uses the same size, family and weight as the pull-down labels via one shared `--menu-font-px` (14); on iOS Safari only, which zooms the page when a field under 16px is focused, the field is laid out at 16px and scaled down to that size (`@supports (-webkit-touch-callout: none)`). Open width is 280px, or less on a phone (`--search-w`, stops at the 25px side margin). A clear button (filled circle with an x, `ICONS.clear`, 44px hit area) sits at the pill's right end: it always takes its space so text never runs under it, fades in only while the field has text (`has-text` class), empties the field and keeps it focused and open (a `mousedown` preventDefault stops the press from stealing focus), and is reachable by Tab. Closing: only leaving search mode (Back, Escape, browser back - see the search flow below); clicking away never closes it. Escape returns focus to Search only if the pill was opened from the keyboard, so a mouse or touch user is never left with a focus ring; pill buttons show focus only via `:focus-visible` and hover only where the device really hovers (no sticky hover after a tap); `prefers-reduced-motion` skips the animation. Opening closes More's pull-down. The pull-down (`.menu-panel`, a sibling of the pill, 8px below it, right-aligned) is Apple-style: closes on outside click, Escape (focus returns to More), or choosing an entry, arrow keys move between entries. It opens and closes instantly (no animation, so there is nothing for `prefers-reduced-motion` to reduce). It is a second liquidGL lens with the same `GLASS_CONFIG` (its own call, `zIndex` 3 so it stacks above both pills) and no CSS fill, blur, rim or shadow of its own. liquidGL draws a lens whenever its element has a box and writes inline `opacity`/`pointer-events` on its targets, so the panel is `display: none` when closed (no scale/fade animation, which would also misalign the lens) and `.menu-panel > *` gets `pointer-events: auto`. Colours come from the palette in `public/css/tokens.css`
(white, light gray, gray, dark gray, black), loaded before the other new-app
stylesheets; the lab doesn't use it. Reuse it on a new page by importing
`mountApp()` (which mounts the menu) and linking `menu.css`.

**Search flow and the results screen (new app only).** The new app has its own
copy of the lab's search engine (`ranking.js`, `api.js`, `games-cache.js`,
`search.js` in `public/js/`, each with a one-line note saying where it came
from; the lab and the new app are now independent - never import across, fix
bugs in both). Pieces with one job each, wired together only in
`public/js/app-shell.js` (`mountApp()` / `unmountApp()`, called by `sign-in.js`
once signed in):

- `search-state.js` - owns whether search mode is on (search pill open, results
  screen showing, Back circle visible - one state) and the query; no DOM.
  `enter()`, `exit(source)`, `setQuery(text)`, `on(event, fn)`. Events: `enter`,
  `query` (every change; typing only ever does this), `exit` (`source`: back /
  back-key / escape / history; the query resets to empty). `cover()` /
  `uncover()` (events `cover`, `uncover`, flag `covered`) are for something
  sitting on top of search - the game page: search stays active and keeps its
  query, results and filter, and only its controls step aside. Nothing is
  discarded, unlike `exit`.
- `game-state.js` - which game page is open (`id`, `isOpen`), no DOM. `open(id)`
  (positive integers only), `close(source)` (back / back-key / escape / search
  / history), events `open` and `close`. `app-shell.js` makes opening cover
  search and closing uncover it.
- `game-page.js` + `css/game-page.css` - the game page, an empty sheet that
  slides up over the results (behaviour in JS, looks in CSS, one number
  `--game-t` between them). Fixed layer at z-index 50 (under the top bar, over
  the page and its scroll indicator): the sheet - top 85px (where the grid
  starts), 25px side inset (none at 640px and below: full width, corners kept), 24px top corners, fill
  `--sheet: #111113`, the card's edge stroke (shared with `.result-cover::after`
  through `--edge-alpha`, 0.14 here), its own scroll area (overlay-scroll,
  `overscroll-behavior: none`). It springs up with `createSpring` (instant under
  `prefers-reduced-motion`; `min(--game-t, 1)` keeps the overshoot off the
  bottom edge). While open the results page stays mounted (scroll position
  kept) but is `inert` and the page can't scroll (`html.is-game-open`).
  Closing slides it down, removes it, and focuses the card that opened it
  (`:focus-visible` ring only). `refreshGlass()` runs after it settles either
  way. **The page behind fades out, not dims:** `createGamePage` reports its
  progress every frame (`onProgress`), which `app-shell.js` hands to
  `pages.setCovered(t)` (`pages.js`); that sets `--page-t` on `#app-content`
  and `pages.css` turns it into opacity. The rule is general - anything that
  covers the content later gets the same fade-out and fade-in by calling
  `setCovered` - and nothing of the results shows around the sheet's corners.
  **Swipe down to dismiss:** dragging the sheet down (touch events for touch,
  pointer events with capture for mouse and pen) follows the finger through the
  same `--game-t` (`spring.set`), only when the sheet's scroll is at the top
  and the movement is downward (upward drags are ignored, so it never fights
  scrolling). Release: past 25% of the visible height, or a flick faster than
  0.5px/ms over the last 100ms, closes it as `game.close("swipe")` (same as
  Back); otherwise it springs back open. Per Apple's Sheets/Modality HIG it has an obvious way
  out (the Back circle, also Escape) and is one sheet at a time; swipe-down to
  dismiss is not built yet.
- `menu.js` - the search pill only reports the field's text (`setQuery`) and
  the Search click (`enter()`), and reacts to the state: the pill opens on
  `enter` and closes on `exit`, and the Back circle shows and hides with them.
  With a game page open the pill and the filter circle fold away on `cover`
  (query kept; they come back on `uncover`, unfocused unless Search was pressed
  from the keyboard), the Back circle stays, Back / Escape close the game page
  instead of leaving search, and Search closes it and returns to search.
- `pages.js` - the page switcher for `<main id="app-content">`. Pages are
  elements; switching _hides_ the one being left (never destroys it, so it keeps
  its state) and `back()` returns to the previous. Today's only page is the
  blank "home". Styles in `public/css/pages.css`.
- `search-session.js` - the live-search brain, no DOM: listens to the search
  state and the filter and drives an injected engine (`search.js`). Exposes
  `status` (blank / loading / partial / done / error), `visible` (the list to
  draw), `bakedTypes`, `generation` and a `change` event. Typing is debounced
  300ms (to go easy on the API); an empty query is blank (no skeletons, no cards). **Baking:** when a
  search starts from an empty query, the types selected at that moment are
  "baked" in. Further keystrokes keep them. With a baked set, any type change
  re-runs the search with the new set (clearing re-runs unfiltered, and that
  search is unbaked); with none baked, type changes only hide or show drawn
  cards client-side. Emptying the query resets baking. In Library is ignored
  (not wired to results yet: it toggles and counts in the badge only, is never
  sent to the API and has no count). Counts describe the current pool (a
  filtered search just shows 0 for unselected types).
- `search.js` (engine, no DOM; copy of the lab's) - `search(query, { types })`:
  re-ranks the last results with no network call while typing (`narrowLast`),
  runs the `games` cache lookup and one IGDB `search` (limit 200) in
  parallel, merges by id (`mergeById`), ranks (`rankGames`), keeps a 60-entry
  memory cache and in-flight dedupe keyed `query|types`, drops superseded
  answers, keeps the head-start (database) copy's cover - the FIRST `cover` entry, the owner's chosen image - for any game we hold while IGDB's copy wins for everything else (IGDB-only games keep IGDB's cover; no extra query), and writes the top 50 back
  through `cache_search_games` without awaiting (a failed write never fails a
  search). **Ranking rule:** the cached head start is painted in the grid as soon as it lands (stored results are quicker than IGDB, which is why they are stored). A game it painted is ranked in the final list using its head-start copy's ranking fields (`rankBasis`, a non-enumerable property read by `ranking.js`), while the fresh copy is what's displayed and written back, so cards on screen never reshuffle when IGDB's newer popularity arrives; IGDB-only games slot in by their own score; narrowing uses the same basis. If a narrowed list is already showing for the current query, a head start doesn't replace it (unless that list is empty). `search-session.js` bumps its run counter on every
  keystroke so an older in-flight search can never paint over the current
  query. `games-cache.js` has the database side, `api.js` the `/api/*` caller.
- `url-state.js` - search text and types live in the address
  (`/?q=zelda&types=0,1`), written with `replaceState` while typing or
  filtering (the single pushed history entry is untouched). Loading a URL with
  `q` enters search with the field filled and the types applied (so baked).
  When the page was loaded straight into search there is no entry of ours to
  pop, so leaving does `replaceState` to `/` instead of `history.back()`.
  `sign-in.js` keeps `?q=` and `?game=` through the Google round trip
  (`returnPath()`). **The game page is its own page:** its address is just
  `/?game=1234` (a positive integer, otherwise ignored), never mixed with the
  search params; the search entry beneath keeps its own `/?q=hades`, and
  nothing here writes the address while a game page is open. Loading
  `/?game=1234` opens the game page alone (any `q` in the link is ignored and
  the address is normalised to `/?game=1234`); closing it goes home.
- `results-page.js` - only renders the session: cards from the 200-result pool,
  20 revealed at a time (`PAGE_SIZE`); while more remain, 12 trailing
  skeletons, and an IntersectionObserver on the first (rootMargin one screen)
  reveals the next 20. Before IGDB answers, the cache head start (or a narrowed list) shows with trailing skeletons, plain skeletons if neither; skeleton nodes already on screen are kept (never rebuilt, so the shimmer doesn't restart on each keystroke) and new ones are synced to a shared shimmer clock via the Web Animations API. When the final list lands cards are reconciled by `data-id` so existing cards and images aren't
  rebuilt. A new search (generation change) resets reveal and scrolls to top.
  Each card carries an invisible `<button class="result-open">` over the whole
  card (aria-label = title); a click reports the id through `onOpen`.
  "No results" and "Couldn't search. Try again." are one dim centred line
  (`.results-message`). If IGDB fails after cached or narrowed results were already showing, they are kept as the final list (status `done` with `failed`, nothing written back) and one small grey line, "IGDB search failed" (`.results-note`), sits under the last card. Cards carry `data-id` and do nothing when tapped.
  Card text is the name, then "type · year" (`releaseYear` from `ranking.js`,
  labels from `result-types.js`). Covers: `<img loading="lazy">` with
  `.is-cover-loading` shimmer until loaded; IGDB URLs are swapped to
  `t_cover_big_2x` for the grid (other hosts untouched); `object-fit: cover`;
  `crossOrigin="anonymous"` is set before `src` so liquidGL can snapshot, with
  one retry without it on error. SteamGridDB and PlayStation send no CORS headers, so liquidGL can't read them into its snapshot (blank grey glass over the card); displayCoverUrl therefore shows them same-origin via `vercel.json` rewrites (`/img/psn/*` and `/img/sgdb/*`, with a long immutable `Cache-Control`). Display only: stored URLs keep their host. Verified under `vercel dev` (restart it after editing `vercel.json`; a UTF-8 BOM in that file stops it starting with "Couldn't parse JSON"). Under `vercel dev` the origin's own Cache-Control comes through rather than ours; proxied images count against Vercel bandwidth, and PlayStation covers are 1440px PNGs, so PlayStation URLs get ?w=528 (IGDB's grid width, ~4x smaller) via URLSearchParams; SteamGridDB grids are already 600x900. **Every cover host must either send CORS or have an /img rewrite, or it shows grey under the glass:** IGDB sends Access-Control-Allow-Origin: *; any other host that only loads after the no-CORS retry logs one console.warn per host. The rewrites only forward to their two fixed hosts (the authority is in the destination, so :path* can only extend the path); a 120ms-coalesced `refreshGlass()` runs after loads. **Fixing a grey card under the glass (any future case):** (1) open the console and look for the per-host warning, or check the card's img: crossOrigin null means it fell back to no-CORS; (2) check the host with `curl -I -H "Origin: http://localhost:3000" <image url>` - no Access-Control-Allow-Origin means it needs a rewrite; (3) add `/img/<name>/:path*` -> `https://<host>/:path*` to `vercel.json` and the host to PROXIED_HOSTS in results-page.js (never a rewrite whose host comes from the request - that would be an open proxy); (4) restart `vercel dev` and confirm in the page that `getImageData` on a canvas with that image doesn't throw. Large originals: use the host's own resize parameter if it has one (PlayStation `?w=`) to keep bandwidth down. No cover (or an image that fails after the retry) shows
  the no-cover tile (see Card). liquidGL recaptures its snapshot (debounced 250ms)
  whenever the page's size changes.
  **Type filter:** `result-types.js` exports `TYPES` (the 15 IGDB categories,
  value 0-14 + label; no "All types" - none selected means all).
  `filter-state.js` is the DOM-free selection (`toggle`, `clear`, `values`,
  `count`, `matches` (type only), `set`, `on("change")`), cleared when search exits. Cards carry
  `data-id`; with no baked set a change hides non-matching drawn cards (see the session above). In `menu.js` a glass
  circle (funnel icon, `#app-filter`) sits left of the search pill and
  grows/shrinks with it (`--search-t`); a white badge with the count shows
  while the filter count is 1+ (types selected + 1 if In Library is on),
  straddling the circle's top-right rim (it sits
  beside the lens, not in it, so nothing clips it). It opens a pull-down
  built on the same `wirePullDown` as More, with three top-level rows: **In
  Library** (`menuitemcheckbox`, "only games I own", `filter.inLibrary`),
  **By Type** (button, `aria-expanded`, sublabel "None applied" / "N
  Selected", chevron that turns down) and, after a divider, destructive
  **Clear all** (resets types and In Library, disabled when both are empty).
  In Library has a trailing checkmark (slot always reserved so rows never shift); each type row instead has a leading to-do circle (`typeCheck` icon: circle path always shown, dim; tick path shown when `aria-checked` is true, full light gray) and `See more` is a dim label followed directly by a dim down chevron;
  toggling keeps the menu open. By Type opens a second glass panel
  (`#app-filter-sub`, its own liquidGL lens, `zIndex` 4, with a light tint, `rgba(9,9,11,.15)`) layered over the
  parent. It starts as the By Type row's rect and grows to full size with
  `createSpring` (CSS vars `--sub-x/-y/-w`, inline height; the lens follows
  via liquidGL's ResizeObserver); its first row is a header (icon, label,
  sublabel, down chevron) that stays where the row was. Top edge = row top,
  shifted up only as far as needed to fit, capped by max-height and
  scrolling inside. The parent's rows stay visible, dimmed to 0.35, and go inert while it is open (the lens tint is drawn under all page text, so a `::before` layer inside the submenu, `backdrop-filter: blur(20px)` plus `rgba(9,9,11,.4)`, blurs the live rows behind it into a smear; it is on the pseudo-element because liquidGL sets `backdrop-filter: none` inline on the lens itself); a
  click on the parent, the header, Left Arrow or Escape folds it back (focus
  returns to By Type). Escape order: submenu, parent, search; an outside
  click closes both. Types: the short list (Main Game, DLC, Remaster,
  Remake, Bundle - `COMMON_TYPES`) plus See more, which grows the height with
  a second spring. Instant under reduced motion. Each panel's width is
  measured once (`--filter-w`, min 220px) so neither changes. Once results
  have loaded each type row shows its count after the label in brackets,
  dimmer, e.g. "Main Game (39)"; the session publishes per-type counts of the
  pool (`filter.setCounts`, `on("counts")`) and they reset on exit. Escape closes the
  pull-down before leaving search. At narrow widths the search pill shrinks
  to make room (about 132px at 390).
  **Overlay scrollbar:** the new app hides native scrollbars
  (`css/overlay-scroll.css`, not loaded by the lab) so content never shifts
  sideways when it starts to scroll. The same file sets `overscroll-behavior:
  none` on the page and inner scroll areas, so phones don't rubber-band past
  the top or bottom edge and an inner list never drags the page.
  `overlay-scroll.js` draws a thin 6px
  indicator in the 25px side margin instead (fixed, starts below the top bar):
  it fades in while scrolling, out after ~1s, widens on hover, can be dragged,
  and hides when nothing scrolls. It follows scroll, resize and a
  ResizeObserver on the content (one update per frame), is `aria-hidden` and
  `data-liquid-ignore` (kept out of the glass snapshot). Used for the page and
  for the filter panel's own scroll area. Instant show/hide under reduced motion.
  **Glass refresh:** liquidGL's snapshot is only retaken (debounced) when the
  page's _size_ changes, so hiding cards with a filter, swapping skeletons for
  cards or emptying the list left the glass showing the old page. The results
  page calls `refreshGlass()` (`glass-refresh.js`, one capture per frame, drops
  any capture in flight) after every DOM change; a capture measured ~10ms at
  60 cards. It reaches into liquidGL's `__liquidGLRenderer__` since the vendor
  file has no public recapture call.
  Card looks are in `pages.css`; it assumes nothing about the lab's search code.
  **Skeleton:** same grid and card shape; a quiet cover tile plus two rounded
  bars (70% and 45% wide) with a soft diagonal shimmer (1.4s sweep that fully leaves the tile, then a 0.6s rest; pure CSS, all in
  sync, no stroke); `prefers-reduced-motion` gets a slow opacity pulse instead.
  `.is-cover-loading` on a real card gives just its cover the same shimmer
  until its image loads. A card with no cover (.is-no-cover) shows #151516 with a crossed-out picture icon centred in #272727, about 28% of the tile width, drawn with a CSS mask (no inline styles); its edge stroke is fainter (10% instead of 25%).
  **Card:** a plain dark cover tile (2:3, e.g. 600x900 art; 10px corners, nothing on top)
  with a static CSS stroke (1px inside on all sides, a 135deg gradient: #F4F4F4
  at 25% at the top-left corner, transparent through the middle, back to 25% at
  the bottom-right corner; a masked pseudo-element),
  then a one-line 13px semibold title and a dimmer 11px "type · year" line, both
  ellipsised; a missing year or type leaves no stray dot. Grid: 3 columns on a
  phone, otherwise auto-fill columns of at least 150px that share the width evenly (12px across, 24px down); content starts 85px down and scrolls
  behind the fixed pills.

Rules: clicking Search does everything at once (pill opens, results page
shows, Back circle slides in, one history entry pushed). The field is not
focused on a click or tap, so a phone's keyboard doesn't pop up until the
field itself is tapped; only opening Search from the keyboard focuses it. Typing,
clearing (delete-all or the clear button, which only empties the field) and
clicking away never open or close anything; the pill stays open with whatever
text for as long as the results page is open. Only leaving closes it: the Back
button, Escape (from anywhere, even with focus elsewhere; an open pull-down
takes Escape first) and the browser's back all do the same thing: leave search
mode, discard the text, collapse the pill, slide the Back circle out, restore
the previous page. Focus returns to Search only when leaving by keyboard.
Pressing the glass or the clear button never steals focus from the field (a
`mousedown` preventDefault). **Back button:** a 44x44 glass circle
(`#app-back`, a fourth liquidGL lens, `zIndex` 1, same `GLASS_CONFIG`) at the
top left, 25px from the top and left (the pill's margins mirrored); it reuses
the pill's classes, so icon, halo, hover/press and `:focus-visible` rules are
shared. It slides in from the left with `--back-t` (0 hidden, 1 shown; the same
kind of spring, `spring.js`; instant under `prefers-reduced-motion`), and on a
phone it makes the search pill 52px narrower (`--search-w`) so they never
overlap. **History:** entering search mode pushes exactly one history entry
(`app-shell.js`, `wireHistory`); every exit route removes it (`history.back()`
when the exit didn't come from the browser), so there is never a stray entry.
An enter that happens while a `back()` is still in flight waits for it. **Game
page:** opening pushes one more entry, `/?game=<id>` only, closing by Back,
Escape or swipe pops it with `history.back()` (so the address shows the search
again), browser back closes
the sheet, and an open that arrives while a `back()` is in flight waits for it,
exactly like search. When the page was loaded straight onto a game there is no
entry to pop, so closing rewrites the address to `/` (home). Home, search and game are one handler (`wireHistory`).

- **Connections** - one row per platform: status dot, account name, expiry
  state, and buttons for connect / refresh / edit / delete. `edit` expands the
  stored record as editable JSON, so credentials can be inspected or corrected
  by hand. The dot and expiry text repaint every 30 seconds and the vault is
  re-read on tab focus, so the row doesn't sit frozen at whatever it said when
  the page loaded - see [auth.md](auth.md) for why, and for what that still
  doesn't catch. Note the button reads `reconnect` whenever a record exists; it
  reverts to `connect` only after a delete, so the wording tracks whether
  anything is stored, not whether it works.
- **Search** - IGDB game search. Typing shows the top 5 matches in a dropdown;
  Enter or the Search button shows the full list, 20 per page. A type dropdown
  beside the input filters **server-side**; a second dropdown above the results
  filters what came back **client-side**, listing only the types actually
  present with counts. The committed search lives in the URL
  (`?q=&type=&filter=&page=`), so it survives a refresh, can be shared, and the
  back button steps through pages instead of leaving the app.

  **One search request, and that is the whole feature.** `igdb.search` returns
  the display fields as well as the ranking ones, so:

  - the dropdown is the top 5 of the list, not a separate query;
  - committing is a cache hit, because the dropdown already fetched it;
  - paging and filtering are array operations - instant, no network.

  It got this way the hard way. It previously used three actions (a light
  "candidates" pool, a "suggest" fast path, and a per-page hydrate for covers
  and summaries), which meant clicking Search re-fetched games it already had
  and then drew the page in four stages. If you find yourself adding a second
  **IGDB** request to the search path, that is the mistake repeating.

  **The local head start.** The `games` table is asked at the same moment IGDB
  is. It answers in ~50ms against IGDB's ~600ms, so a search can paint whatever
  we already hold before the real answer arrives, then merge IGDB over the top
  by id. It is still one IGDB request - the cache lookup runs in parallel and
  is never on the critical path.

  Two things keep the second paint from being noticeable, and both are
  load-bearing:

  - **Ranking parity.** Cached rows store `alternative_names`, `popularity`,
    `hypes` and `first_release_date` for no reason other than to make a cached
    game score _identically_ to the same game from IGDB. Equal scores mean the
    merge can only append; drop one of those fields from the cache write and
    the list visibly reshuffles half a second after every search.
  - **Cards are reconciled by id**, not redrawn. `renderCards()` moves the
    nodes that survive both paints and only re-renders ones whose content
    changed, so covers are not thrown away and recreated.

  The count, type filter and pager stay hidden until IGDB lands
  (`state.partial`). They describe the full result set, and showing
  "6 results" only to say "200 results" a moment later is the one thing that
  would give the two stages away.

  The split across files:

  - `ranking.js` - pure functions, no imports: scoring, ordering, merging,
    filtering, paging maths.
  - `games-cache.js` - the `games` table as a search cache: reads, the
    write-through, and the adapters between the DB shape and the IGDB shape.
  - `search.js` - orchestration only. One cache, plus an in-flight map so
    typing and immediately hitting Search share both the IGDB request and the
    cache lookup rather than each firing their own.
  - `views/search.js` - all the DOM. Keeps one `state` object and renders from
    it; nothing is read back out of the inputs.

  Things worth not undoing:

  - **`narrowLast()` is what makes typing feel live.** A round trip is ~500ms
    and cannot be made faster, so an extended query ("marvel spide" after
    "marvel spid") re-ranks the list already in memory and renders instantly,
    then gets replaced when the real answer lands. It filters on the title
    match alone - filtering on the total score kept popular games that had
    stopped matching.
  - **The result area is drawn in one pass.** Status, filter, count, pager and
    cards are all written by `renderResults()`. Drawing them as each piece
    arrived is what made a search look like three separate loads.
  - **Out-of-order guarding covers both channels.** A cache lookup for an
    abandoned query lands fast and will happily overwrite a newer search if the
    sequence check in `runSearch()` is removed.
  - **Ranking detail lives in [api.md](api.md#api-apiigdbjs)** - why IGDB's own
    order is unusable, why alternative names are a fallback and not a
    best-of, and why popularity comes from `popularity_primitives`.
  - **Cache behaviour lives in [database.md](database.md#games-as-a-search-cache)**
    - what a search writes, and why it cannot thin out a fully synced row.

- **Game** - one game, at `?game=<igdb id>`. Shows the whole `games` row column
  by column, **including the empty ones**, so you can see exactly what we hold
  and what we don't. There is no search box and no id input: the URL is the
  interface. Related-game columns (`dlcs`, `similar_games`, `parent_game`, …)
  render as links to those games' pages, so the id arrays are navigable rather
  than decorative.

  **How fresh it is, and why it's a plain timer.** A row synced within the last
  24 hours renders straight from the database with no IGDB call. Older than
  that, or never fully synced, and it pulls first - so the page is never drawn
  half-empty. There is no "has this changed?" check because IGDB doesn't offer
  one that works: `updated_at` moves on ~76% of games daily while the content
  is provably unchanged, and `checksum` moves with it. Both measured - see
  [api.md](api.md#updated_at-and-checksum-are-not-change-signals). That is also
  why there is no cron job and no webhook.

  Mashing refresh costs nothing: `api/igdb.js` caches game records in memory for
  12 hours, and `game.js` holds a 60-second session cache on top.

  The split across files mirrors search:

  - `game.js` - the freshness decision and the fetch. No DOM.
  - `views/game.js` - all the drawing, from a fixed field table so the layout
    can't reshuffle and a blank column is visibly blank.
  - `games-cache.js` - `loadGame()`, `toDetailRow()`, `saveGameDetails()`
    alongside the search-cache functions, since it is the `games` table module.

  **Search and the game page never read each other's clock.** Search stamps
  `synced_at`; the game page stamps `fully_synced_at`. That separation is the
  whole point - without it, searching for a game would convince its detail page
  it was up to date. The one place they meet is `cache_game_details()`, which
  also refreshes the columns search ranks on. That is safe only because the
  `game` action returns them; see
  [database.md](database.md#cache_game_details).

### Artwork matching

`sgdb-match.js` and `sgdb.js` answer one question: which SteamGridDB entry is
this IGDB game? `sgdb-match.js` is pure and holds all the judgement;
`sgdb.js` does the fetching.

The rule is one game to one entry, or nothing. A DLC must not fall back to the
game it belongs to, and an edition must not fall back to the base game, because
each has its own artwork. "No match" is a normal answer - SteamGridDB is a
community art library, not a catalogue. The reasoning behind every threshold is
in the file's own comments; the API side is in
[api.md](api.md#matching-igdb-games-to-sgdb-entries).

### The media picker (`views/media.js`)

A tab with no tab. `#view-media` and its button exist in the HTML, but the
button is hidden until a game page sends you there, so the only way in is the
"Select media" button. `selectTab()` in `app.js` unhides it on arrival.

It is reached as `?media=<igdb id>`, which is also why `app.js` checks for
`media` before `game` when restoring a URL.

What it does:

- Resolves the SteamGridDB match once and stores it in `games.sgdb_id`. A
  stored id is never re-checked.
- Always offers a **SteamGridDB id field**. That is both the escape hatch when
  matching finds nothing and the deliberate way to link a release to artwork
  that belongs to a different entry - a console edition borrowing the base
  release's art, say.
- Four subtabs: Cover, Logo, Banner, Review. Each of the first three shows
  **everything** SteamGridDB holds for that type, unfiltered. No size, style or
  content filter, on purpose.
- Fetches page by page and draws each page as it lands, with placeholder tiles
  underneath while more is coming. A popular game has several hundred images
  and waiting for the last one before showing the first would look broken.
- Draws thumbnails, saves full-size URLs.
- The grid-size slider changes how many images fit across, not the size of any
  image. It swaps between five size classes rather than setting a width,
  because JavaScript here never writes styles.

Saving calls `saveChosenArt()`, which moves each chosen URL to the front of its
column and leaves everything already there behind it. See
[database.md](database.md#games-columns) for why the front of the array is the
choice.

The picker is a detour, not a destination. Saving returns to the game page,
"Back to game" cancels, and stepping to any other tab closes the Media tab
behind you - reopening it always starts from the game page's button.

### Built to be replaced

This UI is scaffolding. The real design will be produced separately and
hand-coded later, possibly across different pages. So the split below is the
point of the whole structure - keep it intact.

**Reusable logic** - contains no rendering, should survive a total redesign
untouched:

`api.js` `vault.js` `platforms.js` `credentials.js` `connect.js`
`refresh.js` `schemas.js` `search.js` `game.js` `games-cache.js` `ranking.js`
`sgdb.js` `sgdb-match.js` `navigate.js`

The shared auth modules `config.js`, `supabase.js` and `session.js` live in
`public/js/` (app-level, not lab) and are imported by absolute URL (`/js/...`)
so the browser loads one copy.

**Presentation** - throwaway, rewrite freely:

`app.js` `views/connections.js` `views/console.js` `views/search.js`
`views/game.js` `views/media.js` `index.html` `app.css`

A different UI should be able to import the first group unchanged and get every
behaviour - connecting a platform, storing and refreshing tokens, calling any
endpoint. So: no DOM code in the logic modules, and no `fetch`/storage logic in
the views.

**Adding a tab** takes three edits: a `<button data-view="x">` in
`index.html`, a `<section id="view-x">` beside it, and an `x` entry in the
`VIEWS` map in `app.js`. Tab routing and mounting are driven off that map.

**Views never import each other.** A search result opening a game page goes
through `navigate.js`: the caller asks for a view id plus query params, that
module writes the URL and notifies subscribers. `app.js` subscribes to bring
the tab forward, the target view subscribes to redraw itself. This exists
because `history.pushState` does not fire `popstate`, so a view that restores
from the URL would otherwise never hear about a programmatic move - and
because coupling two throwaway presentation modules to each other would defeat
the point of keeping them separately rewritable.

(`connect.js` and `refresh.js` do attach `window` listeners for `message` and
`focus`. That is inherent to popup and background-refresh handling; neither
renders or queries the DOM. `views/connections.js` adds its own `focus`
listener for the vault re-read - that one is a view, so it is allowed to.)

### Styling rules (deliberate, keep them)

All CSS lives in `public/lab/css/app.css`, numbered into twelve sections with a guide
at the top. Two rules make it safe to restyle later without touching logic:

1. **No inline styles anywhere.** JavaScript writes class names only, never
   `style="..."`. An inline style would silently beat any rule in the
   stylesheet, so this keeps the CSS file authoritative.
2. **Colours only via the `:root` variables.** Changing `--bg` / `--text` /
   `--line` recolours the whole app at once.

Styling is intentionally wireframe-only: grayscale, no branding. Build
functionality first, design later. Do not add colour or polish unless asked.

**Testing the glass.** On the plain black home page there is nothing behind the glass to bend or blur, so it shows little more than its rim. To judge it, put real, colourful content under it (a scrolling page of photos was used while tuning, then removed). liquidGL snapshots the page, so content that loads later needs `liquidGL.registerDynamic()` or a fresh snapshot.
To tune the glass live, set `HELPER = true` in `menu.js` (localhost only); it is off because its panel covers the page. Current look: the owner's exact liquidGL settings in `GLASS_CONFIG` (refraction 0.04, aberration 0, bevelDepth 0.06, bevelWidth 0.02, frost 0, blur 8, shadow, specular, tilt off, reveal fade, magnify 1.03, tint rgba(255,255,255,.06)), tuned by the owner on liquidGL's "Tinted Glass" demo card (380px wide); the owner then rejected grey/dark tints in favour of a reference (clear glass that keeps the background's colour, blurred, very slightly lightened), hence the near-clear white tint. `frost` stays 0: it showed grain and doubled images at every strength, even with the third vendor patch; the smooth blur comes from the `blur` option (fifth patch). The thin white rim light comes from the second vendor patch (on whenever `specular` is true), not from CSS. **`bevelWidth` is a fraction of each lens's shorter side**, so the same number gives a 4.5px rim on that card and a useless 0.5px one on the 44px pill; `fitBevel()` in `menu.js` rescales it per lens (and on resize) so every lens gets the rim the owner saw. Values tuned on a different-sized lens need the same treatment. The pill has no CSS layers behind or on it (no fill, rim, smoothing blur, isolation) - they were removed because they can cause visual glitches next to the lens; don't add them back. The only CSS help for legibility is a faint dark halo on the icons (`drop-shadow`) and pull-down labels (`text-shadow`), which the owner approved. Earlier tuning found bevel/specular can draw a dark ragged outline over bright content and bevelWidth alone can darken a band inside the rim - judge on real content.
liquidGL quirk: it sets `pointer-events: none` on its targets (pill and pull-down), so `.menu .menu-row` and `.menu-panel > *` in `menu.css` turn it back on, or nothing can be clicked.
