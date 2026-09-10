# Database

Supabase (Postgres) schema, the sync model, and how platform games resolve to
IGDB IDs. Read this before adding a table, a column, or a sync script.

> **Any new table needs an explicit `grant ... to authenticated`.** This project
> has no default privileges, and Postgres checks privileges _before_ RLS
> policies, so adding policies alone still produces `42501 permission denied`.
> This has already bitten once.

The `platform_credentials` table is documented in [auth.md](auth.md) instead,
since it exists to serve access rather than the game library.

Supabase (Postgres). Three tables: `games`, `player_games`, `achievements`.

### Tables

- **`games`** - IGDB-canonical metadata. The source of truth for game identity. Starts empty and grows organically as platforms are synced. A game can exist here without player data (e.g. added via a future search/browse feature).
- **`player_games`** - one row per `(igdb_id, platform, version)`. Tracks your personal relationship with a game on a specific platform+version. All playtime normalized to seconds on write.
- **`achievements`** - one row per achievement per `player_games` entry. Stores both the definition (name, description, icon, reward) and your earned status (`earned` boolean + `earned_at`). No separate unlocks table - single unified row.

### `games` columns

| Column                  | Type        | Source               | Notes                                                                                  |
| ----------------------- | ----------- | -------------------- | -------------------------------------------------------------------------------------- |
| `id`                    | integer PK  | IGDB                 | IGDB game ID - canonical identity                                                      |
| `name`                  | text        | IGDB                 |                                                                                        |
| `slug`                  | text        | IGDB                 |                                                                                        |
| `summary`               | text        | IGDB                 |                                                                                        |
| `storyline`             | text        | IGDB                 |                                                                                        |
| `genres`                | text[]      | IGDB                 | Array of genre name strings                                                            |
| `cover`                 | text[]      | PSN first, then IGDB | PSN: `PORTRAIT_BANNER`. IGDB: `cover.url`. Arrays so multiple platforms can contribute |
| `banner`                | text[]      | PSN only             | `GAMEHUB_COVER_ART` first, `BACKGROUND_LAYER_ART` appended. No IGDB artworks here      |
| `logo`                  | text[]      | PSN only             | `LOGO` image type from PSN concept media                                               |
| `screenshots`           | text[]      | PSN first, then IGDB | PSN: `SCREENSHOT` type. IGDB: `screenshots[]`                                          |
| `artworks`              | text[]      | IGDB only            | IGDB `artworks[]` - promotional wide images                                            |
| `developer`             | text[]      | IGDB                 | `involved_companies[].company.name` where `developer = true`                           |
| `publisher`             | text[]      | IGDB                 | `involved_companies[].company.name` where `publisher = true`                           |
| `game_type`             | integer     | IGDB                 | 0=main_game, 1=dlc, 2=expansion, 3=bundle, etc. See game type enum                     |
| `release_dates`         | jsonb       | IGDB                 | `[{date (unix), platform (IGDB platform id)}]` - human/region stripped                 |
| `platforms`             | jsonb       | IGDB                 | `[{id, name, abbreviation}]` - IGDB platform objects                                   |
| `rating`                | numeric     | IGDB                 | `total_rating` 0-100                                                                   |
| `rating_count`          | integer     | IGDB                 | `total_rating_count`                                                                   |
| `videos`                | jsonb       | IGDB                 | `[{name, url}]` - YouTube URLs                                                         |
| `websites`              | jsonb       | IGDB                 | `[{url, type}]` - type enriched to human name (official/steam/epic/etc.)               |
| `collections`           | jsonb       | IGDB                 | `[{id, name}]`                                                                         |
| `franchises`            | jsonb       | IGDB                 | `[{id, name}]`                                                                         |
| `dlcs`                  | integer[]   | IGDB                 | IGDB IDs of DLCs                                                                       |
| `bundles`               | integer[]   | IGDB                 | IGDB IDs of bundles this game belongs to                                               |
| `standalone_expansions` | integer[]   | IGDB                 |                                                                                        |
| `remasters`             | integer[]   | IGDB                 |                                                                                        |
| `remakes`               | integer[]   | IGDB                 |                                                                                        |
| `expansions`            | integer[]   | IGDB                 |                                                                                        |
| `expanded_games`        | integer[]   | IGDB                 |                                                                                        |
| `similar_games`         | integer[]   | IGDB                 |                                                                                        |
| `parent_game`           | integer     | IGDB                 | For DLCs/expansions - points to parent                                                 |
| `version_title`         | text        | IGDB                 | e.g. "Game of the Year Edition"                                                        |
| `version_parent`        | integer     | IGDB                 | For editions - points to base game                                                     |
| `external_ids`          | jsonb       | IGDB                 | `{"steam": ["252950"], "psn": ["203715"]}` - source array of UIDs                      |
| `synced_at`             | timestamptz | system               | Last time this row was written                                                         |

**Image array strategy**: PSN images always go first. IGDB images appended after. When a game is later synced from Steam/Epic/etc., images are extended not replaced - existing PSN images stay at the front.

### `player_games` columns

| Column         | Type                | Notes                                                                                       |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `id`           | serial PK           | Surrogate key - keeps FK from achievements simple                                           |
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

### Sync model

Every imported game must resolve to an IGDB ID before anything is written. The flow is always:

```
platform game  resolve igdb_id (by_external for PSN/Steam, igdb search for others)
              upsert into games
              write player_games row pointing to that igdb_id
              write achievements rows pointing to that player_games row
```

No `player_games` row exists without a corresponding `games` row. IGDB is the gate.

### IGDB bridging per platform

| Platform | Bridge method                                        |
| -------- | ---------------------------------------------------- |
| PSN      | `by_external(psn, concept.id)` - 1:1                 |
| Steam    | `by_external(steam, appid)` - 1:1                    |
| Epic     | `igdb search(name)` - no direct ID bridge            |
| Xbox     | `igdb search(name)` - IGDB only has old Xbox 360 IDs |
| EA       | `igdb search(name)` - no EA source in IGDB           |

### Schema principles

- Schema is defined by us, not by API responses. Sync scripts translate from platform format our unified format.
- Platform-specific fields that don't fit the unified schema go in `meta` on `player_games`.
- `achievements` table columns are nullable where platforms don't provide the data (e.g. Steam has no rarity, Xbox has no XP).
- Tables are built column by column with deliberate decisions - not auto-generated from responses.
- Image arrays: PSN first, IGDB appended. Never overwrite - only extend.
