# Database

Supabase (Postgres) schema, the rules for the `games` cache, the sync model,
and how platform games resolve to IGDB IDs. Read this before adding a table, a
column, a database function or a sync script.

## Tables

Seven tables exist in `public` (`ignored_games` and `library_sync` are described under [Sync model](#sync-model)):

- **`games`** - IGDB-canonical metadata, the source of truth for game identity.
  It is a **cache** of IGDB records, not a list of games owned (see
  [`games` is a cache](#games-is-a-cache-not-a-list-of-games-owned)).
- **`player_games`** - one row per `(igdb_id, platform, version)`: your
  relationship with a game on a specific platform and version. This is the
  ownership side. All playtime normalised to seconds on write.
- **`platform_credentials`** - the per-platform token vault. Documented in
  [auth.md](auth.md#platform_credentials-table), since it serves access rather
  than the game library.
- **`owner_allowlist`** - the emails allowed to sign in. Documented in
  [auth.md](auth.md#gate-1---who-can-sign-in).

- **`achievements`** - one row per achievement per `player_games` row. See
  [`achievements` columns](#achievements-columns). Steam and Epic are loaded
  (by `api/_steam-achievements.js` and `api/_epic-achievements.js`); other
  platforms not yet.

## Grants (read before adding a table or function)

**Every new table needs an explicit `grant ... to authenticated`.** This
project has no default privileges, and Postgres checks privileges _before_ RLS
policies, so adding policies alone still produces `42501 permission denied`.
Functions are the same: they need `grant execute ... to authenticated`.

**`service_role` has no `select`, `insert`, `update` or `delete` on a table
by default either** (only `references`, `trigger` and `truncate`), and it is what the nightly
cron (`api/cron-refresh.js`) runs as. Anything the cron touches must be granted
to `service_role` explicitly, or reached through a `security definer` function.
Today that is `select` + `update` on `platform_credentials`, `execute` on
`prune_games_cache()`, and for the library jobs (import, matcher and updater)
`select`/`insert`/`update` on `games`, `player_games` and `achievements`,
`select` + `update` on `library_sync`, `select` on `ignored_games` and
`execute` on `cache_game_details` and `remove_unplayed_ps_plus`. It has no
`delete` anywhere; that function (security definer, `service_role` only) is
the PSN updater's one way to remove a row, and refuses anything played,
bought or holding trophies.

This has already shipped broken once: the cron ran for weeks returning 500 on
its first read because `service_role` lacked `select` on
`platform_credentials`, and nobody noticed because the in-tab refresh
scheduler was covering for it. **Changing what the cron touches means checking
its grants.**

## `games` columns

| Column                  | Type        | Source                  | Notes                                                                                                                        |
| ----------------------- | ----------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | integer PK  | IGDB                    | IGDB game ID - canonical identity                                                                                            |
| `name`                  | text        | IGDB                    |                                                                                                                              |
| `slug`                  | text        | IGDB                    |                                                                                                                              |
| `summary`               | text        | IGDB                    |                                                                                                                              |
| `storyline`             | text        | IGDB                    |                                                                                                                              |
| `genres`                | text[]      | IGDB                    | Array of genre name strings                                                                                                  |
| `cover`                 | text[]      | IGDB, PSN, SGDB         | IGDB `cover.url`, PSN `PORTRAIT_BANNER`, or a pick from SteamGridDB. **First entry is the one shown**                        |
| `banner`                | text[]      | PSN, SGDB               | PSN `GAMEHUB_COVER_ART` then `BACKGROUND_LAYER_ART`; SteamGridDB "heroes". **First entry is the one shown**                  |
| `logo`                  | text[]      | PSN, SGDB               | PSN `LOGO`; SteamGridDB logos. **First entry is the one shown**                                                              |
| `screenshots`           | text[]      | PSN or Steam, then IGDB | PSN: `SCREENSHOT` type; Steam URLs from early test syncs. IGDB: `screenshots[]`                                              |
| `artworks`              | text[]      | IGDB only               | IGDB `artworks[]` - promotional wide images                                                                                  |
| `developer`             | text[]      | IGDB                    | `involved_companies[].company.name` where `developer = true`                                                                 |
| `publisher`             | text[]      | IGDB                    | `involved_companies[].company.name` where `publisher = true`                                                                 |
| `game_type`             | integer     | IGDB                    | 0=main_game, 1=dlc, 2=expansion, 3=bundle, etc. See game type enum                                                           |
| `release_dates`         | jsonb       | IGDB                    | `[{date (unix), platform (IGDB platform id)}]` - human/region stripped                                                       |
| `platforms`             | jsonb       | IGDB                    | `[{id, name, abbreviation}]` - IGDB platform objects                                                                         |
| `rating`                | numeric     | IGDB                    | `total_rating` 0-100                                                                                                         |
| `rating_count`          | integer     | IGDB                    | `total_rating_count`                                                                                                         |
| `videos`                | jsonb       | IGDB                    | `[{name, url}]` - YouTube URLs                                                                                               |
| `websites`              | jsonb       | IGDB                    | `[{url, type}]` - type enriched to human name (official/steam/epic/etc.)                                                     |
| `collections`           | jsonb       | IGDB                    | `[{id, name}]`                                                                                                               |
| `franchises`            | jsonb       | IGDB                    | `[{id, name}]`                                                                                                               |
| `dlcs`                  | integer[]   | IGDB                    | IGDB IDs of DLCs                                                                                                             |
| `bundles`               | integer[]   | IGDB                    | IGDB IDs of bundles this game belongs to                                                                                     |
| `standalone_expansions` | integer[]   | IGDB                    |                                                                                                                              |
| `remasters`             | integer[]   | IGDB                    |                                                                                                                              |
| `remakes`               | integer[]   | IGDB                    |                                                                                                                              |
| `expansions`            | integer[]   | IGDB                    |                                                                                                                              |
| `expanded_games`        | integer[]   | IGDB                    |                                                                                                                              |
| `similar_games`         | integer[]   | IGDB                    |                                                                                                                              |
| `parent_game`           | integer     | IGDB                    | For DLCs/expansions - points to parent                                                                                       |
| `version_title`         | text        | IGDB                    | e.g. "Game of the Year Edition"                                                                                              |
| `version_parent`        | integer     | IGDB                    | For editions - points to base game                                                                                           |
| `external_ids`          | jsonb       | IGDB                    | `{"steam": ["252950"], "psn": ["203715"]}` - source array of UIDs                                                            |
| `alternative_names`     | jsonb       | IGDB                    | `[{name}]` - ranking only, see below                                                                                         |
| `popularity`            | jsonb       | IGDB                    | `{visits, want_to_play}` from `popularity_primitives` - ranking only                                                         |
| `hypes`                 | integer     | IGDB                    | Ranking only. Meaningful for unreleased games                                                                                |
| `first_release_date`    | integer     | IGDB                    | Unix seconds. Duplicates the earliest `release_dates` entry; search returns it directly                                      |
| `name_normalized`       | text        | derived                 | `normalizeName(name)` - lookup key for search, see below                                                                     |
| `sgdb_id`               | integer     | matcher or by hand      | SteamGridDB entry. `null` = never tried, `0` = nothing found, >0 = matched. See below                                        |
| `hltb_id`               | integer     | matcher or by hand      | HowLongToBeat entry this game maps to. `null` = unmatched. See below                                                         |
| `hltb`                  | jsonb       | HowLongToBeat           | `comp_main`, `comp_plus`, `comp_100` in **seconds**, no submission counts. See below                                         |
| `hltb_synced_at`        | timestamptz | system                  | Last time HLTB was consulted, found or not. `null` = never. See below                                                        |
| `synced_at`             | timestamptz | system                  | Last search or detail write (`cache_search_games()` / `cache_game_details()`). Art, `sgdb_id` and HLTB writes don't stamp it |
| `fully_synced_at`       | timestamptz | system                  | Last time the **complete** IGDB record was pulled. `null` = never, see below                                                 |

## Images: `cover`, `banner`, `logo`, `screenshots`

**The first entry of `cover`, `logo` and `banner` is the chosen image** - the
one that is shown. There is no flag and no second column: position is the
choice. Where a URL came from is readable from its host (`images.igdb.com`,
`image.api.playstation.com`, `cdn2.steamgriddb.com`), so provenance never needs
storing either.

Two writers keep these arrays, with different rules. Don't mix their
expectations.

**Lab and the sync functions: merge, never rebuild.** `merge_image_array()`
keeps the order it finds and only appends URLs it has not seen, so nothing is
ever deleted and sources accumulate. The lab's media picker records a choice by
moving its URL to the front (`saveChosenArt()` in
`public/lab/js/games-cache.js`), and because the merge preserves order, it stays
at the front through every future sync. **Anything that rebuilds one of these
arrays instead of merging into it silently throws the choice away.**

**New app (`set_game_art(game_id, kind, url, as_backup default false)`, kind =
cover/banner/logo).** Used by the game page when it fetches art automatically.
The array holds at most one IGDB image plus one other, and this function
_replaces_ rather than appends:

- A **choice** (`as_backup` false) goes first, with the IGDB entry kept behind
  it as the fallback.
- An **automatic pick** (`as_backup` true - the game page's SteamGridDB cover)
  goes behind the IGDB entry as its backup; with no IGDB entry it is simply
  first. Automatic banners and logos use `as_backup` false, since IGDB has none
  and they are first either way.
- An IGDB URL never displaces a non-IGDB one; it goes first only when nothing
  else is there.
- **The owner's choice outranks automatic art:** the game page's automatic
  pull skips any kind already holding a non-IGDB image (`pullFirst()` in
  `game-art.js`), so it only fills gaps.

**The Customize drawer doesn't go through `set_game_art()`.** Its Save writes
each changed kind's whole array with a plain update (`setGameArtArray()` in
`public/js/games-cache.js`): the pick first, always, with one other image kept
behind it (the IGDB one when there is one). The reason is the last rule above -
`set_game_art()` never lets an IGDB image go first, but the owner can pick one
(an IGDB URL added by hand), and Reset needs to put the IGDB poster back in
front. Reset's arrays are the untouched defaults: the IGDB poster first with
SteamGridDB's first static poster behind it (or that alone), and SteamGridDB's
first static banner and logo.

It returns the new array (null if there is no row). The JS mirror is
`applyArtRule()` in `public/js/game-art.js`. Migrations: `game_art_functions`,
`tidy_game_art_arrays` (normalised existing rows once), `set_game_art_backup_mode`.
`merge_image_array()`, `cache_game_details()` and `cache_search_games()` were
not changed for it, so a detail or search sync can still append a changed IGDB
cover and leave three entries. Nothing tidies that up: the game page only calls
`set_game_art()` while `sgdb_id` is still null (or a hand-linked game has no
SteamGridDB image yet), so once a game has been tried the third entry stays.

**Who writes `banner` and `logo`:** only SteamGridDB picks (`set_game_art()` in
the new app, the media picker in the lab) and, historically, PSN artwork from
early test syncs. IGDB has no equivalent, which is why neither cache function
ever names them.

## `sgdb_id`

`NULL` = never tried; **`0` = tried, SteamGridDB has nothing (never retried)**;
above 0 = matched. Once matched it is trusted from then on, never re-checked,
and can be set by hand.

- **New app:** the game page looks the game up on first open
  (`public/js/game-art.js`). **A failed lookup must write nothing**, so the
  next open retries - which is why `resolveSgdb` in `public/js/sgdb.js` throws
  on non-404 failures instead of returning "no match". `set_sgdb_id(game_id,
value)` (security invoker, granted to `authenticated`) writes any id above 0,
  but writes `0` only over `NULL`, so it can never erase a real id.
- **By hand (new app):** the Customize drawer's "no match" pop-up
  (`public/js/sgdb-link.js`) lets the owner pick an entry for a game stored as
  `0`, through the same `set_sgdb_id()`, and the drawer's grids then fill. If
  nothing is saved, the next game page open sees an id above 0 with no
  SteamGridDB image in any of cover, banner or logo, and pulls the first match
  then. There is deliberately no "art pulled" marker (the owner wants this
  handled by the open-game flow, not by a database rule): once any one
  non-IGDB image is stored it is never pulled again, so an entry with no
  images at all is re-asked on every open (cheap).
- **Lab:** filled the first time the media picker is opened, via a plain
  update (`saveSgdbId()`). The lab never writes `0`, and it treats a stored
  `0` like `NULL`: it retries the lookup and, on a match, overwrites the `0`.
  The "never retried" rule only holds in the new app.

## HowLongToBeat: `hltb_id`, `hltb`, `hltb_synced_at`

**`hltb_id` follows the `sgdb_id` precedent exactly**: resolved once, trusted forever, never re-searched, and settable by hand. Once we know which HLTB entry a game is, that does not change, and re-running the match would only create chances to get it wrong. Setting it by hand is how a game the matcher refused - or matched to the wrong entry - gets corrected permanently.

**`hltb` holds seconds, not hours.** `{comp_main, comp_plus, comp_100}` - main story, main + extras, completionist. Converting to hours is presentation and happens at render time (`toHours()` in `public/lab/js/hltb.js`).

Two things HLTB returns are deliberately **not** stored:

- **`comp_all`**, an average across all three play styles. It describes no actual way of playing the game, so it answers "how long is this" with a number nobody's playthrough will resemble.
- **The per-figure submission counts.** They are still used while _matching_, as a tiebreak between two equally plausible entries, but that happens against live search results - nothing reads them back out of the database.

**`hltb_synced_at` is a different clock from the other two, with a different rule.** `synced_at` and `fully_synced_at` track IGDB; this tracks HLTB alone, on a **7-day** interval rather than 24 hours. Completion times are running averages over thousands of submissions, so they move slowly and never jump - a week is generous, and mostly what a refresh buys is a recently-released game's figures settling as its sample grows.

Three behaviours make this survive an unreliable source, and all three matter:

- **A failed lookup writes nothing at all** - not the times, not the timestamp. An HLTB outage therefore looks like nothing happened, rather than a page that empties out, and it retries on the next open rather than in a week.
- **"HLTB has no entry for this game" is a success**, and stamps `hltb_synced_at` with a `null` `hltb_id`. Without that, every page open would re-scrape a game that will never have data. So a null id here **is** distinguishable from "never looked" - check `hltb_synced_at` (where `sgdb_id` uses `0` for the same job).
- **Clearing `hltb_id` forces a fresh search.** `saveHltbId()` also nulls `hltb_synced_at`, so a hand-set id takes effect on the next read.

A cached row that nobody owns is still pruned after 30 days along with its playtimes, the same as everything else here. Harmless - it just means an occasional re-fetch.

## `games` is a cache, not a list of games owned

`games` holds IGDB records for the games we have already looked at. Ownership
is `player_games`. `games` can never answer a search on its own and is not
meant to: it exists so search can show something in ~50ms for the part of the
catalogue we already hold, while IGDB (~600ms) remains the answer. The app does
this through `public/js/search.js` and `public/js/games-cache.js`.

### Two writers, two clocks

| Written by                                      | Touches                                                                                                                                                           | Stamps                         | Leaves alone                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `cache_search_games()` - every committed search | `name`, `slug`, `name_normalized`, `summary`, `game_type`, `first_release_date`, `platforms`, `cover`, `alternative_names`, `popularity`, `hypes`, `rating_count` | `synced_at`                    | everything else                             |
| `cache_game_details()` - a game's detail / page | every IGDB-sourced column                                                                                                                                         | `synced_at`, `fully_synced_at` | `banner`, `logo`, and the HLTB/SGDB columns |

Neither function reads the other's clock, and that is the point.
`synced_at` means "last written by either cache function", and every search
rewrites it, so it can never say whether the detail columns are current. Art,
`sgdb_id` and HLTB writes don't stamp it, so they don't protect a row from
pruning.

There is deliberately **no "is this row complete?" flag**. A search write names
only search-grade columns, so it physically cannot thin out a fully synced row -
the distinction falls out of the write instead of needing to be recorded.

### `cache_search_games(payload jsonb)`

Takes the array of results a search saw. It exists rather than a plain
client-side upsert because it has to:

- **extend `cover` instead of replacing it** - IGDB's cover is appended only if
  it is not already in the array (the image rule above), and
- **`coalesce` every optional column**, so a sparse search result never blanks
  something already known. `popularity` and `hypes` take IGDB's value whenever
  it supplies one, since those are what drift. The exception is `name`, `slug`
  and `name_normalized`, which are always overwritten - so callers must send
  `name_normalized`, or it is blanked.

### `cache_game_details(payload jsonb)`

Writes one complete IGDB record. It is a function rather than a client-side
upsert for two reasons a plain upsert could not honour:

1. **`cover` and `screenshots` are extended, not replaced**, via
   `merge_image_array()`, so an existing first entry keeps its place.
2. **`banner` and `logo` are never named.** IGDB has no equivalent, so naming
   them would blank the SteamGridDB (or PSN) art on every detail sync.

Every other column is `coalesce`d against what is stored, so a sparse IGDB
response can only add information - except `name`, `slug` and
`name_normalized`, which are always overwritten (callers must send
`name_normalized`).

**It also writes the three fields search ranks on** - `alternative_names`,
`popularity` and `hypes` (plus `first_release_date`). That is only safe because
`igdb.js`'s `game` action is a strict superset of its `search` action and always
returns them (see [api.md](api.md#api-apiigdbjs)). If that superset breaks,
opening a game's detail page silently degrades that game's search ranking. This
is the one real hazard in this pair of functions.

Both functions are `security invoker`, so RLS still applies, and both have
`grant execute ... to authenticated`. Helpers `jsonb_to_text_array()`,
`jsonb_to_int_array()` and `merge_image_array()` support them.

### `fully_synced_at` and the daily refresh

Because `synced_at` can't speak for the detail columns, the detail path has its
own clock. Search for a game daily and its `synced_at` is always minutes old,
even if `storyline`, `websites` and `screenshots` have never been fetched.

The lab's game detail tab (`public/lab/js/game.js`) applies:

- **`fully_synced_at is null`** - no full pull has ever happened (true of every
  row search created). The page pulls before rendering, so you never see a
  half-empty page pretending to be a full one.
- **`fully_synced_at` within 24 hours** - rendered straight from the database.
  **Zero IGDB calls.**
- **older than that** - re-pulled, written, rendered.

The interval is `FULL_SYNC_TTL_MS` in `public/lab/js/game.js`. The new app has
no copy of it yet: its game page (`public/js/game-art.js`) only pulls the full
record when `fully_synced_at` is null and the game has not been tried on
SteamGridDB, and never refreshes on a timer.

**Why a timer and not a change signal.** IGDB doesn't have one. Its
`updated_at` moves on ~76% of games every 24 hours while the content is
provably identical, and `checksum` moves in lockstep with it - both measured,
see [api.md](api.md#updated_at-and-checksum-are-not-change-signals). There is
nothing to poll and nothing to subscribe to, so there is no cron sweep and no
webhook. Don't rebuild one. The same measurement shows the data barely moves,
which is what makes a 24-hour interval generous rather than risky.

### Why `name_normalized` exists

Searching `name` directly cannot work: typing "marvel spider man" has to find
"Marvel's Spider-Man", and no `ilike` pattern bridges the apostrophe and the
hyphen. The column holds the output of `normalizeName()` - lowercased,
apostrophes deleted, every other non-alphanumeric collapsed to a space - and is
written by the client so the stored form and the ranker can never disagree. A
GIN trigram index (`pg_trgm`) covers it.

`normalizeName()` lives in `public/lab/js/ranking.js` for the lab and in the new
app's independent copy `public/js/ranking.js`. The two must stay identical, or
rows written by one app stop matching searches from the other.

The lookup filters on the **single longest word** of the query, not the whole
thing, and deliberately over-fetches: "marvel spider man" is not a substring of
the stored "marvels spider man", but "marvel" is. Turning those candidates into
results is `matchScore`'s job on the client, exactly as it is for IGDB's own
loose results.

### Why cached rows carry ranking fields

`alternative_names`, `popularity`, `hypes` and `first_release_date` are stored
for one reason: **so a cached game scores identically to the same game coming
back from IGDB.** Search paints the cache first and merges IGDB over it, and
equal scores are the only reason that merge doesn't visibly reshuffle the list.
They are not there for display. Drop one of them from either write and the bug
comes back looking like a rendering problem.

### Freshness

Every committed search rewrites the search-grade columns of the top 50 results
it saw, so a cached row is never staler than the last time you searched for that
game. Games near release - the ones whose data actually moves - are the ones
being searched most, so they refresh most, with no cron and no IGDB calls beyond
the ones search already makes.

Known gap: a game searched once and then ignored for weeks keeps its old
popularity until something searches it again. Closing that would mean a nightly
refresh pass aimed at upcoming releases - deliberately not built.

### Cache retention: the 30-day self-prune

`games` is the only table here without a natural ceiling. `player_games` grows
with what the platforms report about you; `games` grows with whatever gets
**searched**, so its only real limit is IGDB's catalogue - ~375k games at
~1.4 kB a row, which is more than the 500 MB a free Supabase project gets before
it is forced into read-only mode.

That matters more than it sounds, because **read-only blocks `DELETE` as well as
`INSERT`**. Cleaning up has to happen well before the limit; it cannot be the
response to hitting it.

`prune_games_cache(max_age interval default '30 days')` runs nightly from
`api/cron-refresh.js` and deletes rows that are both:

- **stale** - `synced_at` is older than `max_age`. Every committed search
  rewrites `synced_at` for the results it saw, so a game that keeps turning up
  in searches keeps resetting its own clock. "Stale" really means "nothing you
  have searched lately surfaced this".
- **not referenced by `player_games`**.

**A `player_games` row is the only thing that makes a `games` row permanent.**
Being fully detail-synced does not protect it: a game whose detail page was
opened once and never revisited is still just cache, and IGDB can return it
again on demand. Its SteamGridDB art, `sgdb_id` and HLTB playtimes go with it -
harmless, they are re-fetched on the next open.

Note `player_games` means "a platform gave us data about this game" - owned,
played, or merely present in an API response, depending on the platform. It is
not strictly an ownership list, but it is the thing worth keeping.

The exclusion lives in SQL rather than in the caller because
`player_games.igdb_id` references `games.id`: Postgres would refuse such a
delete anyway, and a caller that forgot the condition would fail the entire
batch rather than skip those rows.

The function is `security definer`, so the cron can run exactly this one
operation without being handed delete rights on `games`. `execute` is revoked
from `public` and granted only to `service_role`, so the browser cannot call
it.

Deleted space is reclaimed lazily by autovacuum, so the reported table size will
not drop immediately after a prune. That is normal.

## `achievements` columns

One row per achievement per `player_games` row, holding both the definition and
your unlock state. Rows are never deleted (`service_role` has no `delete`):
an achievement that disappears from a platform's list stays, which is how the
old CS:GO achievements would have survived CS2 taking over Steam app 730.

| Column          | Type                       | Notes                                                                                                                                                                                                                    |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `owned_game_id` | integer FK player_games.id | Platform and version come from the owned row, so they are not repeated here                                                                                                                                              |
| `platform_key`  | text                       | The platform's own id for the achievement (Steam `apiname`, Epic `name`, PSN `<list>:<trophyId>` such as `NPWR22859_00:12`, since one PSN row can hold several trophy lists). Unique per owned game; what syncs match on |
| `group_name`    | text                       | A real group name or null. Null for every row of a game means one flat list                                                                                                                                              |
| `name`          | text                       | Display name (the unlocked one, so hidden entries still have their real name)                                                                                                                                            |
| `description`   | text                       | Real description, including for secret entries where the platform gives it                                                                                                                                               |
| `icon`          | text                       | The unlocked (colour) icon only; locked is shown by greying it out                                                                                                                                                       |
| `rarity`        | numeric(5,2)               | % of that platform's players who unlocked it. Same scale everywhere, but each platform counts only its own players                                                                                                       |
| `tier`          | text                       | PSN only: `bronze`/`silver`/`gold`/`platinum`                                                                                                                                                                            |
| `points`        | integer                    | Epic XP, Xbox gamerscore                                                                                                                                                                                                 |
| `secret`        | boolean                    | Hidden on the platform. The real description is still stored; the UI blurs it                                                                                                                                            |
| `unlocked_at`   | timestamptz                | Null means locked                                                                                                                                                                                                        |

What each platform gives (checked against the real library, Nov 2026):

- **Group names:** PSN yes (`getTitleTrophyGroups`, e.g. "Watcher", "1.6 Update";
  the `default` group is the base game). Steam only on the community page below,
  for some games. Epic no: every achievement carries its set id and `isBase`, so
  base game and each add-on can be told apart, but sets have no name field at
  all (the API rejects `name`, `title`, `displayName`).
- **Secret text:** PSN (`trophyDetail`) and Epic (`unlockedDescription`) give it
  for every hidden entry. Steam's official API never does; the public
  community page `steamcommunity.com/profiles/<id>/stats/<appid>/achievements/?l=english`
  embeds it, plus group names. That page is unofficial and rate-limits, so
  Steam jobs must fetch it slowly and fall back to the official API without
  the secret text.
- **PSN specifics:** group names are stored only when the list has DLC groups
  or the row holds several lists (the `default` group is then named after the
  game); otherwise `group_name` is null. Rarity comes with the player's
  progress, so lists whose progress Sony refuses (games never started, trials)
  have no rarity and are all locked. Old PS3 trophies can be earned with no
  date (Skylanders Giants: one of four); with no date they are stored locked,
  by the owner's choice.
- **Xbox specifics:** no groups, so `group_name` is always null. Secret
  achievements come with their real description. One earned with Xbox's
  "never" date (`0001-01-01`) is stored locked, as for PSN. Titles Xbox only
  saw launched have no achievements through Xbox.
- **EA specifics:** the full list, locked included, with descriptions and
  icons. No groups, rarity, points or secret flag (`secret` is false).
  Locked achievements carry the current time as their date, so a date is
  stored only for earned ones.

## `player_games` columns

| Column         | Type                | Notes                                                                                                                    |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`           | serial PK           | Surrogate key - keeps the FK from `achievements` simple                                                                  |
| `igdb_id`      | integer FK games.id |                                                                                                                          |
| `platform`     | text                | Hardware family: `playstation`, `pc`                                                                                     |
| `version`      | text                | Store/version: `ps5`, `ps4`, `ps3`, `steam`, `epic`, `microsoft`, `ea`. Xbox rows can be null or hand-set: see Xbox rows |
| `playtime`     | bigint              | Seconds. Normalized on write from whatever format the platform uses                                                      |
| `last_played`  | timestamptz         |                                                                                                                          |
| `first_played` | timestamptz         | PSN only - most platforms don't provide this                                                                             |
| `play_count`   | integer             | PSN only - most platforms don't provide this                                                                             |
| `acquisition`  | timestamptz         | When the game was added to the library: Epic `acquisitionDate`, EA `addedDate`                                           |
| `meta`         | jsonb               | Platform-specific IDs and data needed for re-syncing. Shape varies per platform - see below                              |
| `synced_at`    | timestamptz         | Last time this row was written                                                                                           |

**Unique constraint**: `(igdb_id, platform, version)` - one row per game per platform version.
Before matching (`igdb_id` null) the store id guards against duplicates
instead: unique indexes on `meta->>'appid'` for Steam rows and
`meta->>'namespace'` for Epic rows. PSN rows have three: `(version,
meta->>'concept_id')` when there is a concept, the first of `meta.title_ids`
(PS4/PS5), and the first trophy list (PS3). Xbox rows use
`meta->>'title_id'`, whatever their version, and EA rows
`meta->>'origin_offer_id'`. Nulls count as distinct, so
versionless rows never clash with each other or with a versioned row.

### `player_games.meta` shape per platform

**PSN**:

```json
{
  "title_ids": ["CUSA13323_00", "CUSA18353_00"],
  "concept_id": 235227,
  "trophy_sets": [{ "id": "NPWR15120_00", "service": "trophy" }],
  "ps_plus": false,
  "name": "Example"
}
```

- `title_ids` - the Sony codes this row stands for: the played ones on this
  console, or the purchased one for an unplayed game. Several only when one
  console lists more than one code for the game (a game plus its bonus
  content). Empty for PS3 rows.
- `concept_id` - the game's Sony concept, for every code including unplayed
  ones, from the public catalogue
  (`m.np.playstation.com/api/catalog/v2/titles/<code>/concepts?age=99&country=GB&language=en-GB`,
  no sign-in; it matched `games`' `concept.id` for every played code).
  Absent only for PS3 rows. Groups a game's codes and is IGDB's PSN id.
- `trophy_sets` - every trophy list of these codes (from `trophymap` `sets`;
  a code can own several). Empty means no list is known: either no trophies
  (apps), or a game never launched by the owner or by `trophymap`'s fallback
  account. PS3 rows hold their one list.
- `ps_plus` - true only when the game came from PS Plus and no copy was bought
  (`purchased` `membership`). Free-to-play claims count as bought; Sony doesn't
  separate them.
- `name` - the catalogue's English name (`nameEn`; purchases and play history
  use the store language), else Sony's own name. Kept only until a match
  exists, as for Steam.

**Steam**:

```json
{
  "appid": 252950,
  "has_stats": true,
  "name": "Example"
}
```

- `name` - Steam's name, kept only until a match exists, then removed.
- `has_stats` - from `has_community_visible_stats`. False means no achievements exist - skip `schemas`/`achievements` calls.
- `progress_hidden` - Steam refuses this player's unlocks (403), which happens
  for games no longer on the account (free weekends, removed free games). The
  achievement list is still stored; unlocks already saved are kept.
- `secret_text_unavailable` - the profile page was read but has no text for
  some hidden achievements (placeholders, or no page at all, as for Spacewar),
  so the updater stops asking for it.
- `no_achievements` - `has_stats` is true but a full load found no
  achievements (Steam stats without achievements exist). Stops the updater
  reloading it every run; asked again only when the game is played.
- `store_type` - set only when Steam's store says the app isn't a game
  (`demo`, `software`, `tool`, or `unknown` when the store has no record), so
  the owner can spot candidates for `ignored_games`.

**Epic**:

```json
{
  "namespace": "9773aa1aa54f4f7b80e44bef04986cea",
  "catalog_item_id": "...",
  "app_name": "Sugar",
  "product_id": "...",
  "name": "Example",
  "has_achievements": true
}
```

- One row per `namespace`, which is also the `sandboxId` for achievement
  queries. A namespace can hold several apps that Epic times separately
  (Fortnite and Rocket Racing; two Unreal Engine builds): they stay one row,
  with their playtime added together, and `app_name` is just the first one.
- `name` - Epic's name, kept only until a match exists, as for Steam.
- `has_achievements` - the game appears in `progress`.
- `acquisition` holds `acquisitionDate`.
- `last_played`: Epic has no such date anywhere (API, launcher, local files;
  checked Nov 2026). It can only be the day a sync sees playtime go up, so it
  needs a daily sync and has no history before it. Dates the owner gave by hand
  stay.

**Xbox** (any row with a `title_id`):

```json
{
  "title_id": "1234567890",
  "product_id": "9XXXXXXXXXXX",
  "has_achievements": true,
  "name": "Example"
}
```

- `title_id` - Xbox's id for this build, used for the `achievements` action
  and by the updater to find the row. Every title has one.
- `product_id` - the Microsoft Store id, IGDB's `microsoft` external id.
  Absent for games Xbox only saw launched.
- `has_achievements` - `totalGamerscore` above 0 in the games list.
- `name` - Xbox's name, kept only until a match exists, as for Steam.

**EA**:

```json
{
  "origin_offer_id": "Origin.OFR.50.0003428",
  "game_slug": "need-for-speed-heat",
  "achievement_set_override": "50317_195133_50844",
  "name": "Example"
}
```

- `origin_offer_id` - EA's id for the game; the import and updater find the
  row by it.
- `game_slug` - what EA's playtime lookup takes.
- `achievement_set_override` - absent when the game has no achievements;
  otherwise passed to the `achievements` action.
- `name` - EA's name, kept only until a match exists, as for Steam.

EA rows: every full game EA lists, including Steam-linked copies (EA also
times those); the owner ignores what isn't wanted. `acquisition` holds
`addedDate`; `last_played` is EA's date where it has a real one, which is
almost never, so as for Epic it comes from playtime going up. An Xbox row the
owner had labelled `ea` by hand goes back to versionless when EA adds the
game, as for the other launched-only Xbox rows.

### Has achievements? (per platform)

No dedicated boolean column - derive it from `meta`:

| Platform | Signal                                                          |
| -------- | --------------------------------------------------------------- |
| PSN      | `meta.trophy_sets` is not empty                                 |
| Steam    | `meta.has_stats = true`                                         |
| Epic     | `meta.has_achievements = true` (the game appears in `progress`) |
| Xbox     | `meta.has_achievements = true`                                  |
| EA       | `meta.achievement_set_override` is present                      |

## Sync model

Import and matching are separate steps. A platform's list is saved first, as
the platform gives it; the IGDB link is filled in afterwards and never
re-resolved once set. So `player_games.igdb_id` is **nullable**: a row without
one is an owned game still waiting for a match. Built so far: Steam's one-time
first import, the matcher, and the [Steam updater](#the-steam-updater); Epic's
one-time first import, matched with the same matcher, and its achievements
(`_epic-achievements.js`, one call per game; add-on sets stay with the game,
since Epic gives them no name); PSN's one-time first import (the early test
rows were updated in place and kept their links), matched with the same
matcher, and its trophies (`_psn-achievements.js`, one `trophies` call per list
plus `groups` for names; every list matched the per-tier counts in `titles`); Xbox's
one-time first import, matched with the same matcher, and its achievements
(`_xbox-achievements.js`, one call per store title flagged
`has_achievements`; earned counts and gamerscore matched the games list) and
the [Xbox updater](#the-xbox-updater); and EA's one-time first import, matched
with the same matcher, and its achievements (`_ea-achievements.js`, one call
per game with an achievement set; counts matched EA's) and the
[EA updater](#the-ea-updater). Trophies
go to rows that were played or bought (`ps_plus` false) or whose list is on the
owner's account; unplayed PS Plus rows get none until played or bought.

```
platform game -> write player_games row (igdb_id null)
              -> match: resolve igdb_id (by_external for PSN/Steam, igdb search for others)
              -> upsert into games, set player_games.igdb_id
              -> write achievements rows pointing to that player_games row
```

A game is owned once seen; there is no "still in library" flag. The one
exception is a PSN game from PS Plus that was never played: it stays only while
Sony still lists it as active.

**Layering.** Each import starts from the player's own records - what they
played and what they unlocked - and adds the other calls (ownership lists,
catalogue lookups) on top as extra layers. A secondary call never replaces or
filters out the player's own data: anything played counts, whether or not it is
still owned.

**`ignored_games`** (`platform`, `external_id`, `name`): things a platform lists
that are not games (software, demos, playtests). Telling the agent to ignore one
deletes it from `player_games` and adds it here; imports and matching skip
anything listed. Nothing is auto-detected by name.

**The matcher** (`api/_match.js`, one small adapter per platform:
`_match-steam.js`, `_match-epic.js`, `_match-psn.js`, `_match-xbox.js`, `_match-ea.js`) is server code, not an endpoint: the
[Steam updater](#the-steam-updater) calls `matchPlatform(platform, options)`
after adding new rows, and it can also be run by hand with node.
It runs as `service_role`. It links only on certainty, and real data about the
owner's own copy always comes first; store pages, names, dates and platforms
are only additions for when that isn't enough. Concretely: the store id listed
in IGDB, or a single clear winner whose name, release date, companies and
website agree. A weak name (Steam's "Call of Duty®" hub is Modern Warfare II)
can still link when the same release week, company and website all agree.
Anything unsure
stays unlinked with `meta.review = {reason, candidates}` for the owner to pick,
and is not retried unless asked.

A row is what the owner owns: when that is an edition (the game plus more), the
row links the edition, not the base game. Add-ons are separate IGDB game types
and never a row's link.

When a row's store ids point at several IGDB games, add-ons are dropped (if only
add-ons match, the row goes to the next tier or the name search). For ids the
owner is known to own, an edition replaces its base game; otherwise ownership of
the edition isn't known, so the base game is kept. Then bundles go if anything
else is left, then whatever the platform's own data rules out. More than one
left means review.

Steam's owned-games call needs `skip_unvetted_apps=0`, or it silently leaves out
small free games. Even then it permanently leaves out some free games (Dota 2,
GeoGuessr), demos, and games from free weekends or removed licences. Games
shared through Steam Family are never returned.

**Steam rows:** `platform = 'pc'`, `version = 'steam'`, `playtime` in seconds
(Steam gives minutes), `last_played` null when never played or not known (a
game seen only in the recently-played list). First played, play
count and acquisition stay empty - no source provides them. A unique index on
`meta->>'appid'` (Steam rows only) prevents duplicates. `meta` is described
under [Steam meta](#player_gamesmeta-shape-per-platform).

**PSN rows**: `platform = 'playstation'`, one row per
game per console, `version` `ps5` (`PPSA` codes), `ps4` (`CUSA`) or `ps3`.
Nothing is merged in the database. Which games get a row:

- everything played or with trophies (play history, plus games Sony dropped
  from it but still lists in purchases with the owner's trophies);
- PS3 trophy lists, which link to no game (trophies only, no play data);
- bought games never played;
- PS Plus games never played, while still active.

Which console: a game (one `concept_id`) gets a row only for each console that
holds the owner's data - playtime, or a trophy list in the owner's `titles`.
Both PS4 and PS5 rows exist only when both have data. With
no data anywhere it is one row, PS5 if a PS5 code is owned. Unowned codes of a
stored game add nothing, apart from making the row bought rather than
`ps_plus`. Sony sometimes gives a game's PS4 and PS5 versions different
concepts: when one purchase (`productId`) holds both, they are still one game;
otherwise nothing links them, and the owner ignores the extra one. When one console lists
several played codes for a game, `playtime` and `play_count` are added together,
`first_played` is the earliest and `last_played` the latest. Trophies not
confirmed unlocked are stored locked, including trials whose progress Sony
refuses. `ignored_games.external_id` is a Sony code, so ignoring one (a demo or
an art book under a game's name) removes only that code, not the game.

**Xbox rows**: `platform = 'pc'` (the owner has no console). One row per Xbox
title, all of them; the owner ignores what isn't wanted afterwards. Two kinds:

- **Store titles** (with a `productId`): `version = 'microsoft'`, including
  console builds played on another console signed into Xbox. `playtime` from
  `minutesPlayed`, stored even when 0, and achievements.
- **Launched titles** (no `productId`): PC games from any launcher that Windows
  saw being opened while signed into Xbox. Only `last_played`; `version` is
  null. Windows doesn't catch every game.

`last_played` from `lastTimePlayed`; first played, play count and acquisition
stay empty. `ignored_games` uses `platform = 'xbox'` and the `title_id`.

A versionless row means "only a date". After matching, if another row has the
same IGDB game (the same game on another store) it stays versionless and,
when rows are merged by IGDB game, adds its date to that game (newest wins).
If no other row has the game (a launcher we don't import), or the owner says
it was a separate copy from another launcher, the owner sets the version by
hand (`riot`, `rockstar`); it can't be a version the game already has, which
the unique constraint refuses. Playtime the owner reads off that launcher can
be set by hand too: the updater writes playtime only for store titles. So can
achievements (GTA V's `rockstar` row: earned ones from Rockstar's Social Club
accomplishments page, the locked ones from the same game's PSN list, minus
the platinum); the updater never touches a launched title's list. The
updater finds rows by `title_id` and never changes
`version`, so hand-set versions stay. A future Riot import should take over a
hand-labelled `riot` row rather than add one.

### The Steam updater

`api/_steam-update.js` keeps Steam rows current: new games, playtime, last
played and achievements. It is server code run as `service_role`, called only
by the endpoint `api/library-sync.js` (signed-in `POST`, optional
`{force: true}`). It fetches only what changed, so it is safe to run often.

**Where games come from** - three lists, merged by app id:

- `GetOwnedGames`: the main list. Required; an empty answer stops the run
  (private profile or Steam down, never "you own nothing").
- `ClientGetLastPlayedTimes`: undocumented. Every app the API key's own
  account ever launched, with playtime and last played but no names. The only
  source for the games the owned list leaves out. Could stop working; the
  updater carries on without it.
- `GetRecentlyPlayedGames`: names, and catches a just-played game even if the
  list above fails.

Apps only in the last two are named via `IStoreBrowseService/GetItems`
(store type in `meta.store_type`), falling back to the achievements schema's
name. Everything not in `ignored_games` is added; only the owner ignores. If
the store can't be reached, those apps wait for the next run.

**What it does per run:**

1. Adds new rows, then runs the matcher on them. A matcher failure (IGDB
   down) is recorded in the summary and the run carries on.
2. For every game whose playtime, last played or achievements flag changed
   (most recent first): a quick unlock check (`refreshSteamUnlocks`), or a
   full achievements load if the list is missing or incomplete. The row's
   playtime is saved only after its achievements succeed, so a failure is
   retried next run.
3. Full loads for anything left incomplete, skipping `progress_hidden`,
   `secret_text_unavailable` and `no_achievements` rows.

Profile page reads are 3 seconds apart. The endpoint stops starting new games
after 240 s (Vercel's limit is 300 s, set in `vercel.json`); what's left is
picked up next run.

### The Epic updater

`api/_epic-update.js`, same shape and summary as Steam's, called by the same
endpoint. One library call gives every namespace with its playtime (split apps
added together).

1. New namespaces (not in `ignored_games`) are added with their catalog title
   as `meta.name` and `has_achievements` from `progress`, then matched.
2. Every game whose playtime went **up** gets its achievements re-read
   (`loadEpicAchievements`), then its playtime, and `last_played` = the moment
   of the run. That is the only last-played Epic has, so its accuracy is the
   sync's frequency: the nightly run makes it at worst the day. A lower
   playtime is ignored as a glitch. `has_achievements` is only ever switched
   on, since a failed lookup reads as "none".
3. Games flagged `has_achievements` with no list yet get a full load.

It stops if Epic returns no playtime at all while rows have some (the library
call carries on without it). It uses the stored token and never renews it:
that is `cron-refresh`'s job, at 03:00 UTC, and the token lasts about 36 hours,
so it is valid at night; if it has expired the run fails with that reason.

### The Xbox updater

`api/_xbox-update.js`, same shape and summary as Epic's, called by the same
endpoint, which first calls `ensureFreshAccess(db, "xbox")` (Xbox access lasts
an hour). One `games` call with the `detail,achievement` extras gives every
title with its playtime, last played and earned count.

1. New titles (not in `ignored_games`) are added exactly as the first import
   added them, then matched.
2. A row is re-read when its playtime or last played went up, or Xbox's earned
   count is above the unlocks stored. Xbox's last played is when a session
   started, so an unlock later in that session only shows in the count.
   Achievements are loaded first (`loadXboxAchievements`), then the play data,
   so a failure is retried next run. Play data only moves forward, and
   `version` is never written. `has_achievements` is only ever switched on.
3. Rows flagged `has_achievements` with no list yet get a full load.

It stops if no store title has playtime while rows have some (the games action
skips the playtime call quietly when it fails).

### The PlayStation updater

`api/_psn-update.js`, same shape and summary as Steam's (plus `checked` and
`removed`), called by the same endpoint. PSN access lasts an hour, so before
each run the endpoint calls `ensureFreshAccess(db, "psn")` from
`_platform-refresh.js`, which renews and saves the sign-in exactly as
`cron-refresh` does when it expires within 15 minutes; the updater itself
never renews.

1. **Quick check, every run:** `recent` (one call, the 50 latest). Its
   `lastPlayedDateTime` equals play history's (all 50 checked). If no game is
   newer than its row's `last_played` (or unknown), purchases were checked in
   the last 20 hours and no played or bought row lacks its trophies, the run
   ends (`checked: "quick"`, about a second).
2. **Play history** (when something moved): played codes are grouped onto
   their row (by code, else by concept on that console) and summed as at
   import; a row changes only when its last-played date or playtime went up.
   A game first played on a console takes over its unplayed row on the other
   console if that row has nothing stored, else gets a new row. New codes get
   their lists from `trophymap`.
3. **Purchases, at most every 20 hours:** active `purchased` entries (code and
   membership, so a PS Plus game later bought counts) not seen last time
   (`library_sync.state.purchase_entries`) are grouped by concept: a
   stored game can only become bought (`ps_plus` false); a new game gets one
   row, PS5 if a PS5 code is among them. Unplayed PS Plus rows with no
   trophies whose codes are no longer active are removed through
   `remove_unplayed_ps_plus(row_ids)`, a security definer function that refuses
   any row played, bought or holding trophies. Not when the profile says PS
   Plus has lapsed (the list is kept), and not when more than 60 would go at
   once or Sony returns nothing (taken as a glitch).
4. Matching, then trophies (`loadPsnTrophies`) for every changed row and for
   played or bought rows still without trophies, then the play data - so a
   failure is retried next run.

Tested Nov 2026 against the real account through the cron endpoint: a quick
run, a played game wound back (restored from Sony with its trophies re-read),
an unplayed PS Plus game leaving the catalogue (removed), and the same game
then re-added as a new claim and matched.

Not handled, left on purpose as rare: a new claim of a game whose PS4 and PS5
versions have different concepts becomes two rows, since only
the import paired them by `productId`; and a bought, unplayed game first played
on its other console keeps its old row next to the new one, because that row's
locked trophy list can't be deleted.

### The EA updater

`api/_ea-update.js`, same shape and summary as Epic's, called by the same
endpoint, which first calls `ensureFreshAccess(db, "ea")` (EA access lasts
about four hours). One `library` call gives every full game with its playtime.

1. New games (not in `ignored_games`) are added exactly as the first import
   added them, then matched.
2. Every game whose playtime went **up** gets its achievements re-read
   (`loadEaAchievements`), then its playtime, and `last_played` = the moment
   of the run, or EA's own date when it has one from the last two days. A
   lower playtime is ignored as a glitch.
3. Games with an achievement set but no list yet get a full load; a set EA
   adds later is picked up and kept.

Tested Nov 2026 against the real account, including through the cron
endpoint: a run with nothing new, a game wound back (restored with its
achievements re-read), and a game removed then re-added and matched.

### library_sync and the nightly runs

**`library_sync`** (`platform` PK, `running_since`, `last_finished_at`,
`last_result` jsonb, `state` jsonb): one row per platform (`steam`, `epic`,
`playstation`, `xbox`, `ea`); a new platform needs its row inserted. `state` is the
updater's own bookkeeping between runs (PSN: `purchases_checked_at`,
`purchase_entries`). Each platform runs on its own: the endpoint skips one
if its last run finished under 15 minutes ago (unless `force`), and takes its
lock by setting `running_since` in a single conditional update, so two runs
can't overlap; a lock older than 10 minutes counts as dead. `last_result` is
the updater's summary, or `{error, at}` when the run failed (a failure doesn't
set `last_finished_at`, so it doesn't hold the next run back).
`authenticated` has `select`, `service_role` `select` + `update`.

Two ways in, same code:

- **The lab** (signed-in `POST`): every platform in parallel, progress
  streamed as JSON lines (`{platform, step}`, then
  `{done, platforms: {steam: outcome, epic: outcome}}`, where an outcome is
  `{result}`, `{skipped}`, `{busy}` or `{error}`). Under `vercel dev` the lines
  arrive all at once at the end; live streaming on Vercel is untested.
- **Nightly** (Vercel Cron `GET` with `CRON_SECRET`): one cron entry per
  platform (`?platform=steam`, `?platform=epic`, `?platform=playstation`,
  `?platform=xbox`, `?platform=ea`), each its own function call
  with its own 300 s, at `0 22 * * *` UTC. Vercel fires anywhere in that hour,
  so in Porto it's 22:00-23:00 in winter and 23:00-24:00 in summer: late, but
  before midnight, so a date stamped then is still that day. Without
  `?platform` it runs all. Answers JSON, 500 if any platform failed. Nightly
  runs only happen on the deployed site.

### IGDB bridging per platform

| Platform | Bridge method                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------- |
| PSN      | `by_external(psn, concept_id)`, then `igdb search(name)` (below)                                  |
| Steam    | `by_external(steam, appid)` - 1:1                                                                 |
| Epic     | store bridge (below), then `igdb search(name)`                                                    |
| Xbox     | `by_external(microsoft, productId)` for MS titles, else `igdb search(name)`                       |
| EA       | the same game's Steam / Microsoft Store ids from EA's catalogue, then `igdb search(name)` (below) |

**EA.** IGDB has no EA source. EA's offer details list the same game on other
stores (`firstParties`); IGDB files some of them: the Steam app id
(`CONTENT_ID`; the `OFFER_ID` is a package and the Epic ids matched nothing,
Nov 2026) and Microsoft Store product ids (partner `UNKNOWN`). These are EA's
cross-references, not what the owner bought there - NFS Heat's Microsoft id is
IGDB's Deluxe Edition - so an exact hit is refined like PSN's: an edition only
when EA's name contains its `version_title`, else the base game. The rest go to
the name search on EA's name and release date, PC games only.

**PSN.** IGDB's PSN source holds only Sony concept ids (no per-console codes,
nothing at edition level), and each concept points at one IGDB game. A concept
spans a game and its editions, so IGDB may have filed it on an edition while
the base game carries no PSN link (F1 25 -> "Iconic Edition"). The adapter's
`refine` then looks at that edition family (`igdb.editionFamilies`: the base
and every `version_parent` edition) and picks an edition only when the
catalogue's name contains its IGDB `version_title` ("Weird West: Definitive
Edition"), else the base game; members on another console, or with a PSN
concept of their own (The Walking Dead: Saints & Sinners' base game), are never
picked. Sony's own suffixes ("Terraria – PlayStation®4 Edition") name no IGDB
edition. Remasters, remakes and expanded games are separate IGDB games, not
editions, and stay as linked: Spider-Man PS5 -> Remastered, Until Dawn PS5 ->
the remake, Ghost of Tsushima -> Director's Cut, Telltale's Batman -> Episode 1,
Just Dance: Decades of Hits -> Just Dance 2023 (whose store page Sony reused).
Rows without an IGDB concept (and PS3 rows, which have none) use
the name search with the catalogue's name, publisher and release date
(`_match-psn.js`), and only IGDB games on that console fit. The adapter sets
`perVersion`, so a PS4 and a PS5 row of one game both link the same IGDB game.

**Xbox.** Only store titles have an id IGDB knows (`meta.product_id`); launched
titles go to the name search with nothing but their name, since Xbox gives no
release date and its developer/publisher names often differ from IGDB's (and
would need the owner's sign-in at match time). Only IGDB games on PC fit. The
adapter sets `perVersion`, so a versionless row and a store row can link one
game. A stricter rule (link only when exactly one PC game has the exact name)
was tried and dropped: it gave the same result as the normal scoring, which
already sends same-name ties to review.

**Epic store bridge.** IGDB's Epic ids are Epic Store ids (the 32-hex one is
the store offer id, the dashed one the store page id), which the library and
catalog never return. Epic's launcher GraphQL (no sign-in needed) bridges them
from the namespace:

- `Catalog.catalogOffers(namespace)` returns every offer (`id`, `offerType`,
  `offerMappings.pageSlug`). The offer `id` is IGDB's 32-hex uid, so
  `by_external(epic, offerId)` works directly.
- `Catalog.catalogNs(namespace).mappings(pageType:"productHome")` returns the
  store slug. IGDB keeps it in `external_games.url` and in `websites.url`
  (`.../p/<slug>`, older entries `.../product/<slug>`), which catches games
  whose IGDB entry only holds the slug.

Against the real library (Nov 2026) this reached most namespaces. Misses:
delisted games for which Epic returns nothing (Dauntless, original GTA V, NBA
2K21, Evil Dead) - IGDB still has them with Epic store links, so a name search
finds them; Football Manager 2020 (IGDB holds only a `/product/` website link);
and non-game items not in IGDB. An older route (the `productmapping` list
plus store-content pages) reached far fewer, because that list misses newer slugs
with a random suffix.

How `_match-epic.js` uses it. What the owner owns comes first; everything else
only helps when that isn't enough. Each run also reads the account's
entitlements (`entitlement-public-service-prod08.ol.epicgames.com/entitlement/api/account/{epicAccountId}/entitlements`,
with the stored access token; the run stops if it has expired). An entitlement
is an "audience" item, and current offers list theirs in `items` (the
library's `catalogItemId` is only the game files and is in no offer). The exact
lookup runs in tiers:

1. offers the owner owns - every item in the offer is entitled, or the offer is
   named after an owned item no offer contains. If the owner also has an
   edition item that no offer sells any more (Civilization VI's "Platinum
   Edition Audience"), the link moves up to the one IGDB edition of that game
   with that name;
2. only if that finds nothing: the namespace's `BASE_GAME` and `EDITION` offers
   (a namespace also returns every add-on,
   so the rest are skipped). When these hit several games, the titles of owned
   items that no offer contains pick between them (Dying Light's "Enhanced
   Edition Audience" picks the Enhanced Edition).

After that, the name search. Search candidates count as store-linked when IGDB
lists any of the namespace's offer ids or its store slug, and are ruled out when
IGDB lists them only on non-desktop platforms (not PC or Mac) or first released
more than a year after the owner got the game (a year allows pre-purchases).
Store details for the search come from the owned offer, or else the own offer
whose title is closest to the imported name.

At import every row linked, each to a different game; the only owned editions
were Dying Light (Enhanced) and Civilization VI (Platinum). Re-matching every
row as if new, with the names restored, gave the same games for all the
others.

### Schema principles

- Schema is defined by us, not by API responses. Sync scripts translate from
  platform format -> our unified format.
- Platform-specific fields that don't fit the unified schema go in `meta` on
  `player_games`.
- Tables are built column by column with deliberate decisions - not
  auto-generated from responses.
- Image arrays are merged, never overwritten (see [Images](#images-cover-banner-logo-screenshots)).
