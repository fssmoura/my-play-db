# The lab (`/lab/`)

The lab is the old tabbed app, kept as a test bench for every feature:
`public/lab/`, served at `/lab/`. Keep it working and don't redesign it; work
on the new app at `/` must not change it (the app's copies of the lab's code
are independent - see [frontend.md](frontend.md#copies-of-the-labs-code)). Both
share the API, the sign-in and the database.

The lab has no sign-in of its own: when signed out it redirects to
`/?next=<its own path>`. See [auth.md](auth.md#gate-1---who-can-sign-in).

Tabs: Connections, API console, Search, Game, and Media (the artwork picker,
which has no visible tab - it is reached from a game's "Select media" button
as `?media=<igdb id>`).

## Rules

- **No inline styles.** JavaScript writes class names only, never
  `style="..."`; all CSS lives in `public/lab/css/app.css`, and an inline style
  would silently beat it. (The one `.style` in `views/media.js` is
  SteamGridDB's art-style data field, not CSS.) Colours only via the `:root`
  variables (one exception: the modal `.overlay` backdrop's
  `rgba(0, 0, 0, 0.35)`).
- **`public/lab/js/schemas.js` must be kept in step with the handlers.** A new
  action or option that isn't there is unreachable from the API console.
- **EA's `refresh` is deliberately left out of `schemas.js`.** Why:
  [auth.md](auth.md#ea-renewing-from-session-cookies).
- **Logic and presentation stay apart.** The views, `app.js`, `index.html` and
  `app.css` are throwaway; everything else should survive a redesign
  untouched. So: no DOM code in the logic modules (except `connect.js`, which
  opens popups and redirects and needs `document.hasFocus()` for clipboard
  capture), no `fetch`/storage logic in
  the views.
- **Views never import each other.** They move between tabs through
  `navigate.js`, because `history.pushState` does not fire `popstate`, so a
  view restoring from the URL would never hear about a programmatic move.

## Decisions worth not undoing

**Search: one IGDB request is the whole feature.** `igdb.search` returns the
display fields as well as the ranking ones, so the dropdown is the top 5 of
the list, committing is a cache hit, and paging and filtering need no network.
It used to use three actions (a light candidate pool, a "suggest" fast path
and a per-page hydrate), which re-fetched games it already had and drew the
page in four stages. Adding a second IGDB request repeats that mistake.

- **The `games` cache is a head start:** it answers in about 50ms against
  IGDB's 600ms, so search paints what we hold, then merges IGDB over it by id.
  That only goes unnoticed because cached games score identically
  ([database.md](database.md#games-is-a-cache-not-a-list-of-games-owned)) and
  cards are reconciled by id, not redrawn.
- The count, type filter and pager stay hidden until IGDB lands - "6 results"
  then "200 results" would give the two stages away.
- `narrowLast()` re-ranks the list in memory while typing an extended query.
  It filters on the title match alone - filtering on the total score kept
  popular games that had stopped matching.
- The result area is drawn in one pass; drawing each piece as it arrived
  looked like three separate loads.
- A cache lookup for an abandoned query lands fast and will overwrite a newer
  search if the sequence check in `runSearch()` is removed.

**Game tab.** Freshness is a plain 24-hour timer (why there is no "has it
changed?" check:
[api.md](api.md#updated_at-and-checksum-are-not-change-signals); the two sync
clocks: [database.md](database.md#fully_synced_at-and-the-daily-refresh)). It
shows every column of the row, including empty ones, so you can see exactly
what we hold.

**Media picker.**

- The SteamGridDB match is resolved once and stored in `games.sgdb_id`; a
  stored id is never re-checked.
- There is always a SteamGridDB id field - the escape hatch when matching finds
  nothing, and the deliberate way to link a release to another entry's art (a
  console edition borrowing the base release's, say).
- Cover, Logo and Banner show everything SteamGridDB holds, unfiltered on
  purpose.
- Saving moves each chosen URL to the front of its column and keeps the rest
  behind it ([database.md](database.md#images-cover-banner-logo-screenshots)).
- The grid-size slider swaps between size classes because the lab's JS never
  writes styles.

**Connections.** The button reads `reconnect` whenever a record exists and
`connect` only after a delete - it tracks whether anything is stored, not
whether it works. Why rows repaint and re-read the vault:
[auth.md](auth.md#keeping-the-connections-screen-honest).

## Artwork and playtime matching

The matching rules for SteamGridDB and HowLongToBeat apply to the lab and the
app alike, and live in [api.md](api.md#matching-igdb-games-to-sgdb-entries)
(SteamGridDB) and [api.md](api.md#matching-igdb-games-to-hltb-entries)
(HowLongToBeat).
