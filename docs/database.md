# Database

Supabase (Postgres) schema, the rules for the `games` cache, the sync model,
and how platform games resolve to IGDB IDs. Read this before adding a table, a
column, a database function or a sync script.

## Tables

Four tables exist in `public`:

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

**Planned, not built:** an `achievements` table - one row per achievement per
`player_games` entry, holding both the definition (name, description, icon,
reward) and your earned status (`earned` + `earned_at`) in a single row, with no
separate unlocks table. Columns would be nullable where platforms don't provide
the data (Steam has no rarity, Xbox has no XP). Nothing reads or writes it yet.

## Grants (read before adding a table or function)

**Every new table needs an explicit `grant ... to authenticated`.** This
project has no default privileges, and Postgres checks privileges _before_ RLS
policies, so adding policies alone still produces `42501 permission denied`.
Functions are the same: they need `grant execute ... to authenticated`.

**`service_role` has no `select`, `insert`, `update` or `delete` on a table
by default either** (only `references`, `trigger` and `truncate`), and it is what the nightly
cron (`api/cron-refresh.js`) runs as. Anything the cron touches must be granted
to `service_role` explicitly, or reached through a `security definer` function.
Today that is `select` + `update` on `platform_credentials` and `execute` on
`prune_games_cache()`; on `games` and `player_games` it has no `select`,
`insert`, `update` or `delete`.

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

- A **choice** (`as_backup` false - future manual picks) goes first, with the
  IGDB entry kept behind it as the fallback.
- An **automatic pick** (`as_backup` true - the game page's SteamGridDB cover)
  goes behind the IGDB entry as its backup; with no IGDB entry it is simply
  first. Automatic banners and logos use `as_backup` false, since IGDB has none
  and they are first either way.
- An IGDB URL never displaces a non-IGDB one; it goes first only when nothing
  else is there.

It returns the new array (null if there is no row). The JS mirror is
`applyArtRule()` in `public/js/game-art.js`. Migrations: `game_art_functions`,
`tidy_game_art_arrays` (normalised existing rows once), `set_game_art_backup_mode`.
`merge_image_array()`, `cache_game_details()` and `cache_search_games()` were
not changed for it, so a detail or search sync can still append a changed IGDB
cover and leave three entries. Nothing tidies that up: the game page only calls
`set_game_art()` while `sgdb_id` is still null, so once a game has been tried
the third entry stays.

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
catalogue we already hold, while IGDB (~600ms) remains the answer. Both apps do
this - the lab through `public/lab/js/search.js` and
`public/lab/js/games-cache.js`, the new app through its own copies
`public/js/search.js` and `public/js/games-cache.js`.

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

## `player_games` columns

| Column         | Type                | Notes                                                                                       |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `id`           | serial PK           | Surrogate key - keeps the FK from the planned `achievements` table simple                   |
| `igdb_id`      | integer FK games.id |                                                                                             |
| `platform`     | text                | Hardware family: `playstation`, `pc`, `xbox`                                                |
| `version`      | text                | Store/version: `ps5`, `ps4`, `steam`, `epic`, `ea`, `xbox`                                  |
| `playtime`     | bigint              | Seconds. Normalized on write from whatever format the platform uses                         |
| `last_played`  | timestamptz         |                                                                                             |
| `first_played` | timestamptz         | PSN only - most platforms don't provide this                                                |
| `play_count`   | integer             | PSN only - most platforms don't provide this                                                |
| `acquisition`  | timestamptz         | Epic only - `acquisitionDate` (when the game was added to library)                          |
| `meta`         | jsonb               | Platform-specific IDs and data needed for re-syncing. Shape varies per platform - see below |
| `synced_at`    | timestamptz         | Last time this row was written                                                              |

**Unique constraint**: `(igdb_id, platform, version)` - one row per game per platform version.

### `player_games.meta` shape per platform

**PSN**:

```json
{
  "title_ids": ["PPSA27360_00", "CUSA52314_00", ...],
  "concept_id": 10011898,
  "category": "ps5_native_game",
  "service": "none(purchased)",
  "np_communication_id": "NPWR49547_00",
  "np_service_name": "trophy2"
}
```

- `title_ids` - all SKUs sharing this concept (from `concept.titleIds`). Needed for `trophymap` calls.
- `np_communication_id` + `np_service_name` - resolved via `trophymap`. Required to call `trophies`. Absent if the game has no trophy set.
- `category` - `ps5_native_game` / `ps4_game` / `pspc_game`. Determines `version` field.
- `service` - `none(purchased)` / `ps_plus` / `ps_now`.

**Steam** (planned):

```json
{
  "appid": 252950,
  "has_stats": true
}
```

- `has_stats` - from `has_community_visible_stats`. False means no achievements exist - skip `schemas`/`achievements` calls.

**Epic** (planned):

```json
{
  "namespace": "9773aa1aa54f4f7b80e44bef04986cea",
  "catalog_item_id": "...",
  "app_name": "Sugar",
  "product_id": "..."
}
```

- All from `library` response. `namespace` is the `sandboxId` for achievement queries.
- No `np_communication_id` equivalent - games without achievements simply won't appear in `progress`.

**Xbox** (planned):

```json
{
  "title_id": 1820250788,
  "devices": ["XboxSeries"]
}
```

- `title_id` (integer) is needed for the `achievements` action.
- No playtime for most titles - only MS-native games report `minutesPlayed`.

**EA** (planned):

```json
{
  "origin_offer_id": "Origin.OFR.50.0003428",
  "game_slug": "need-for-speed-heat",
  "content_id": "195133",
  "achievement_set_override": "50317_195133_50844"
}
```

- `achievement_set_override` - null means no achievements. Non-null is passed directly to `achievements` action.
- `game_slug` was used for playtime lookups in the library response.

### Has achievements? (per platform)

No dedicated boolean column - derive it from `meta`:

| Platform | Signal                                                                          |
| -------- | ------------------------------------------------------------------------------- |
| PSN      | `meta.np_communication_id` is present                                           |
| Steam    | `meta.has_stats = true`                                                         |
| Epic     | game appears in `progress` response (only games with achievements are returned) |
| Xbox     | `achievements` action returns data (no ahead-of-time signal)                    |
| EA       | `meta.achievement_set_override` is non-null                                     |

## Sync model

Not built yet beyond early PSN tests. Every imported game must resolve to an
IGDB ID before anything is written. The flow is always:

```
platform game -> resolve igdb_id (by_external for PSN/Steam, igdb search for others)
              -> upsert into games
              -> write player_games row pointing to that igdb_id
              -> write achievements rows pointing to that player_games row (planned table)
```

No `player_games` row exists without a corresponding `games` row. IGDB is the
gate.

### IGDB bridging per platform

| Platform | Bridge method                                        |
| -------- | ---------------------------------------------------- |
| PSN      | `by_external(psn, concept.id)` - 1:1                 |
| Steam    | `by_external(steam, appid)` - 1:1                    |
| Epic     | `igdb search(name)` - no direct ID bridge            |
| Xbox     | `igdb search(name)` - IGDB only has old Xbox 360 IDs |
| EA       | `igdb search(name)` - no EA source in IGDB           |

### Schema principles

- Schema is defined by us, not by API responses. Sync scripts translate from
  platform format -> our unified format.
- Platform-specific fields that don't fit the unified schema go in `meta` on
  `player_games`.
- Tables are built column by column with deliberate decisions - not
  auto-generated from responses.
- Image arrays are merged, never overwritten (see [Images](#images-cover-banner-logo-screenshots)).
