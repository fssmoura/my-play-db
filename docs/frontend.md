# Frontend

Structure of the lab SPA (`public/lab/`, served at `/lab/`) and the styling rules.
**Everything in this doc describes the lab at `/lab/`**, not the new app at `/`.
Read this before changing anything under `public/lab/`.

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
screen): `public/js/menu.js` (`PILL_ITEMS` for the pill's buttons - Profile, which does nothing yet, and More - and `MENU_ITEMS` for the pull-down that More opens) and `public/css/menu.css`. The pull-down has two entries: the flask icon + "Switch Environment" linking to `/lab/`, and a red "Sign Out" (Apple's systemRed `--destructive` in `tokens.css`, a deliberate exception to the palette, for critical actions only) that signs out via `/js/session.js` and lands on `/`. Entries are data (`href` or `action`, plus `destructive` and `separatorBefore`); Sign Out sits in its own group under a thin divider. The pill is fixed 25px from the top and right; 44px tall (HIG minimum target),
22px radius (true half-height), 4px side padding, no CSS fill/rim/blur/shadow of its own (liquidGL draws all of it). Inside, the two buttons are 44x44 hit areas edge to edge, each with a 20px light-gray icon. Pull-down rows are 36px with a mouse and 44px on touch (`pointer: coarse`); their hover/focus highlight is a full capsule, and the panel radius is concentric with it (row radius + 6px padding: 24px, 28px on touch). The glass is drawn by
[liquidGL](https://github.com/naughtyduk/liquidGL) (npm `liquid-gl` 3.0.0, MIT, no dependencies; WebGPU, then WebGL, then a CSS fallback automatically), served from `public/vendor/liquidGL.js` (licence beside it) and loaded by `menu.js` with a dynamic `import()`. **That copy is patched:** upstream measures refraction as a fraction of the whole page snapshot, so on a long scrolling page the vertical bend grew with page length (about 6x too strong on the glass test page) and the glass looked like a flat smear. The one-line patch, in both shaders and marked `my-play-db patch`, measures the vertical bend against the page width too. A second patch adds a thin white rim light when `specular` is on (upstream's specular is only two faint glows inside the lens), and a third makes `frost` a smooth blur instead of grainy random sampling. The drop shadow is liquidGL's own (`shadow: true`), unpatched - a stronger one was tried and rejected as too prominent. A fourth patch paints the tint over the glass (normal blend) instead of multiplying, so a grey tint actually looks grey - upstream's multiply can only darken. A fifth adds a `blur` option (CSS px): the snapshot is blurred once before upload with a downsample/upsample chain (the "dual filter" blur games use), giving a smooth blur. Use it instead of `frost`, which scatters a few samples per pixel and looks grainy or doubled at any real strength; canvas `filter: blur()` was tried first and is silently ignored on the tall snapshot canvas (and missing in Safari). A sixth adds dimming: the glass always darkens what shows through by 30% (keeping its colour), and by up to a further 40% where the background is bright, so white text stays readable on anything. Re-apply all six if liquidGL is ever upgraded. It is called on the fixed `#app-menu` pill. Its settings live in one `GLASS_CONFIG` object in `menu.js` (Figma dispersion -> `aberration`, frost -> `frost`). **To tune the look:** set `HELPER = true` in `menu.js` (localhost only) to load liquidGL's helper GUI (`liquidGL-helper.js`) with live sliders; copy the values you like back into `GLASS_CONFIG`. It is off by default and never loaded in production. If the library fails to load, the pill is plain (no fill) and the buttons still work. The pull-down (`.menu-panel`, a sibling of the pill, 8px below it, right-aligned) is Apple-style: closes on outside click, Escape (focus returns to More), or choosing an entry, arrow keys move between entries, and it respects `prefers-reduced-motion`. It is a second liquidGL lens with the same `GLASS_CONFIG` (its own call, `zIndex` 2 so it stacks above the pill) and no CSS fill, blur, rim or shadow of its own. liquidGL draws a lens whenever its element has a box and writes inline `opacity`/`pointer-events` on its targets, so the panel is `display: none` when closed (no scale/fade animation, which would also misalign the lens) and `.menu-panel > *` gets `pointer-events: auto`. Colours come from the palette in `public/css/tokens.css`
(white, light gray, gray, dark gray, black), loaded before the other new-app
stylesheets; the lab doesn't use it. Reuse it on a new page by importing
`mountMenu()` and linking `menu.css`.

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
Two liquidGL quirks: it sets `pointer-events: none` on its target (the pill), so `.menu .menu-row` in `menu.css` turns it back on or the buttons can't be clicked; (and its frost renders grainy in software-rendered browsers).
