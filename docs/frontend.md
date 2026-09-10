# Frontend

Structure of the `public/` SPA and the styling rules. Read this before changing
anything under `public/`.

`public/` is a vanilla ES-module SPA. No bundler, no framework, no build step -
the browser loads the files as written, so editing them is immediate.

Three tabs behind a Google login gate: **Connections**, **API console**,
**Search**.

- **Connections** - one row per platform: status dot, account name, expiry
  state, and buttons for connect / refresh / edit / delete. `edit` expands the
  stored record as editable JSON, so credentials can be inspected or corrected
  by hand.
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
  request to the search path, that is the mistake repeating.

  The split across files:

  - `ranking.js` - pure functions, no imports: scoring, ordering, filtering,
    paging maths.
  - `search.js` - fetching and caching only. One cache, plus an in-flight map
    so typing and immediately hitting Search share a request rather than each
    firing their own.
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
  - **Ranking detail lives in [api.md](api.md#api-apiigdbjs)** - why IGDB's own
    order is unusable, why alternative names are a fallback and not a
    best-of, and why popularity comes from `popularity_primitives`.

### Built to be replaced

This UI is scaffolding. The real design will be produced separately and
hand-coded later, possibly across different pages. So the split below is the
point of the whole structure - keep it intact.

**Reusable logic** - contains no rendering, should survive a total redesign
untouched:

`api.js` `vault.js` `session.js` `platforms.js` `credentials.js` `connect.js`
`refresh.js` `schemas.js` `search.js` `ranking.js` `config.js` `supabase.js`

**Presentation** - throwaway, rewrite freely:

`app.js` `views/connections.js` `views/console.js` `views/search.js`
`index.html` `app.css`

A different UI should be able to import the first group unchanged and get every
behaviour - connecting a platform, storing and refreshing tokens, calling any
endpoint. So: no DOM code in the logic modules, and no `fetch`/storage logic in
the views.

**Adding a tab** takes three edits: a `<button data-view="x">` in
`index.html`, a `<section id="view-x">` beside it, and an `x` entry in the
`VIEWS` map in `app.js`. Tab routing and mounting are driven off that map.

(`connect.js` and `refresh.js` do attach `window` listeners for `message` and
`focus`. That is inherent to popup and background-refresh handling; neither
renders or queries the DOM.)

### Styling rules (deliberate, keep them)

All CSS lives in `public/css/app.css`, numbered into eleven sections with a guide
at the top. Two rules make it safe to restyle later without touching logic:

1. **No inline styles anywhere.** JavaScript writes class names only, never
   `style="..."`. An inline style would silently beat any rule in the
   stylesheet, so this keeps the CSS file authoritative.
2. **Colours only via the `:root` variables.** Changing `--bg` / `--text` /
   `--line` recolours the whole app at once.

Styling is intentionally wireframe-only: grayscale, no branding. Build
functionality first, design later. Do not add colour or polish unless asked.
