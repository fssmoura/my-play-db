# The lab (`/lab/`)

The lab is the old tabbed app, kept as a test bench for every feature:
`public/lab/`, served at `/lab/`. Keep it working and don't redesign it; work
on the new app at `/` must not change it (the app's copies of the lab's code
are independent - see [frontend.md](frontend.md#copies-of-the-labs-code)). Both
share the API, the sign-in and the database.

The lab has no sign-in of its own: when signed out it redirects to
`/?next=<its own path>`. See [auth.md](auth.md#gate-1---who-can-sign-in).

Tabs: Connections, API console, Library, Game, Media and Achievements. The last
three have no visible tab until reached: Game from clicking a matched library
card (`?game=<igdb id>`; unmatched cards don't open), Media and Achievements
from a game's buttons (`?media=<igdb id>`, `?achievements=<igdb id>`). Game's
tab then stays for the visit; the other two close as soon as you leave them.
Every tab is in the address (`?tab=<id>`, or `?game=`/`?media=`/
`?achievements=`), so a refresh stays on it. All views mount at page load,
hidden or not, so anything a view should do only when seen (the Library's
sync) must watch for its section being shown.

The search tab was removed; search lives in the app at `/`.

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

**Library tab.** These rules are for the lab only. It is one list with one
card per IGDB game, so the same game from several platforms is one card. Its
playtime is added up and its last played is the newest. Its achievements are
the stores' lists combined, for display only: the same achievement on two
stores counts once, earned if earned on either, and one only a store has (a
PlayStation platinum) is added. Stores name the same achievement slightly
differently, and one list can hold two that differ only by punctuation
("BB" and "BB..." in Death Stranding), so pairs are scored on name, then
description, settled best first and used once; low scores stay separate. On
the owner's library (Nov 2026) this paired renamed ones correctly ("A Road
Called Steve" / "It's Called Steve") and made no wrong pairings, where adding
the lists up doubled them. A store hiding the player's progress is left out
when another shows it. The store buttons
next to the sort buttons narrow the list to games owned on any of the chosen
stores; the cards stay merged. A versionless row whose game another platform
has is only a date ([database.md](database.md#sync-model)): it feeds that date
but doesn't count as a store, so it isn't under Unknown. The matching lives in
`public/lab/js/achievements.js`, shared with the Achievements tab, so a card
and its game's list always agree.

**Achievements tab.** One list per game, combined across stores by the same
matching as the Library cards. The base list is the store with the most
information (PlayStation, then Xbox/Epic, then Steam, then EA); name, image,
group, grade and rarity come from it, and the other stores' copies only add
whether and when it was earned (the first time, on any store; which store isn't
shown). Groups follow the base store's order (PlayStation's trophy order; Steam keeps none ([database.md](database.md#achievements-columns)), so its largest group leads), the first open. PlayStation's first
group, and any unnamed one, is always "Base Game"; achievements no copy matched
go together in "Other". A group name starting with the game's name (IGDB's, or
the base group's as the store spells it) shows only the rest ("Marvel's
Midnight Suns: Blood Storm" -> "Blood Storm"), unless nothing would be left,
the rest starts with a number or roman numeral (a sequel: Hitman 3's "HITMAN
2"), or with a bracket. The line under the title adds "Platinum in" or
"Completed in" (100%): from the first play (PlayStation's `first_played`) or
the first unlock on any store, whichever is earlier, since the game may have
been started on another store; to the platinum or last unlock. Sort buttons
order within each group, never across groups. The rarity label is ours, the
same for every store (under 5% ultra rare, 10% very rare, 20% rare, 50%
uncommon). Only locked secret achievements are blurred; unlocked ones are no
longer spoilers.

**Game tab.** Freshness is a plain 24-hour timer (why there is no "has it
changed?" check:
[api.md](api.md#updated_at-and-checksum-are-not-change-signals); the two sync
clocks: [database.md](database.md#fully_synced_at-and-the-daily-refresh)). It
shows every column of the row, including empty ones, so you can see exactly
what we hold. Its sections start collapsed; ones you open stay open for the
visit, across games.

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
