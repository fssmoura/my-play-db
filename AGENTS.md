# my-play-db

Personal game library - pulls PSN (and eventually other platforms) data into one place.

This is not a public service. It's a private data pipe. The API layer has zero business logic, no database, no merging. It maps 1:1 to what the source provides so a sync script or frontend can decide what to store and how.

## Dev

- **`vercel dev`** - local server at localhost:3000 (only way to test API functions). Do NOT use VS Code Live Server.
- **`npx prettier --write <file>`** - formatting. No linter, no test framework, no build step configured.

### API testing protocol (MUST follow every time)

1. User confirms `vercel dev` is running.
2. Construct the GET URL(s) with query params, show them to the user, and tell them to open in browser to see the JSON response.
3. Also call `curl.exe -s "<url>"` in this terminal to read the response myself.
4. Only after BOTH the user confirms they saw the JSON AND I have curl output, declare the endpoint verified.

Example flow:

```
# I tell the user:
Open this in your browser: http://localhost:3000/api/epic?action=auth&options={"..."}
(I also run curl myself behind the scenes)

# Then after both confirm:
auth  - returns access_token, refresh_token, account_id
```

## Stack

- **CommonJS** everywhere (api/). `require()`, not `import`. package.json has no `"type": "module"` - psn-api is CJS.
- **Vanilla JS frontend** (public/) - ES modules in browser, no bundler, no framework, no TypeScript.
- **Dependencies**: `psn-api` ^2.14.0. Steam, Epic, and IGDB handlers use raw `fetch`.

## Architecture

```
Browser (ES module)  POST /api/psn    Vercel serverless  psn-api  PlayStation Network
                     POST /api/steam  Vercel serverless  fetch    Steam Web API
                     POST /api/epic   Vercel serverless  https    Epic internal APIs
                     POST /api/ea     Vercel serverless  https    EA GraphQL + REST APIs
                      POST /api/igdb   Vercel serverless  https    IGDB v4 (Twitch-backed)
                      POST /api/sgdb  Vercel serverless  https    SteamGridDB v2 (community game art)
```

```
my-play-db/
  api/
    _cors.js               # CORS allow-list + preflight
    _auth.js               # Supabase JWT gate - every handler requires the owner
    _platform-refresh.js   # server-side token refresh (psn/epic/xbox)
    cron-refresh.js        # nightly Vercel Cron job
    psn.js                 # PSN handler - 7 actions
    steam.js               # Steam handler - 7 actions (incl. openid_verify)
    epic.js                # Epic handler - 5 actions
    xbox.js                # Xbox handler - 4 actions
    ea.js                  # EA handler - 3 actions
    igdb.js                # IGDB handler - 4 actions
    sgdb.js                # SteamGridDB handler - 5 actions
  public/
    index.html             # app shell: login gate + tabs
    steam-callback.html    # bare Steam OpenID return target
    css/
      app.css              # ALL styling, 10 numbered sections
    js/
      config.js            # Supabase URL + publishable key (browser-safe)
      supabase.js          # supabase-js client (ESM from esm.sh)
      session.js           # Google OAuth sign in/out, JWT access
      api.js               # single /api/* caller, injects bearer token
      vault.js             # platform_credentials CRUD
      platforms.js         # per-platform connect/refresh + expiry normalization
      credentials.js       # pure credential extractors (no imports, testable)
      connect.js           # popup / redirect / clipboard capture
      refresh.js           # in-tab auto-refresh scheduler
      schemas.js           # per-action parameter definitions for the console
      app.js               # boot, auth gate, tab routing
      views/
        connections.js     # platform list + connect/edit/delete
        console.js         # generic action runner
  .env.local               # local env (managed by `vercel env pull`)
  package.json
  vercel.json              # outputDirectory + cron schedule
```

## API (api/psn.js)

POST or GET with `{ npsso, accessToken, refreshToken, action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

GET query params are parsed with `JSON.parse` where possible - numbers, booleans, arrays, and objects in query strings must be valid JSON. Plain strings pass through as-is.

| Action      | What it needs                                   | Returns                                                                                                                 |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `auth`      | npsso or refreshToken                           | accessToken + refreshToken + expiry                                                                                     |
| `profile`   | accessToken                                     | profile + presence + trophy summary                                                                                     |
| `games`     | accessToken [+ limit/offset]                    | played games (auto-paginates, ps4/ps5/pspc). `limit` returns N most recent                                              |
| `titles`    | accessToken [+ limit/offset]                    | trophy-focused title list (auto-paginates, page size 800). npCommunicationId + lastUpdatedDateTime + progress per title |
| `recent`    | accessToken [+ limit/categories]                | recently played games (lightweight GraphQL, no pagination). Default limit 50.                                           |
| `trophymap` | accessToken + titleIds[]                        | npTitleId { npCommunicationId, npServiceName }. Falls back to proxy account for titles the user never synced.           |
| `trophies`  | accessToken + npCommunicationId + npServiceName | full trophy details for one game. If the user hasn't synced the game, returns definitions with all `earned: false`.     |

Auth order: NPSSO exchangeNpssoForAccessCode exchangeAccessCodeForAuthTokens. The `auth` action is handled before the generic authorization path - do not change this order.

## API (api/steam.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

| Action          | What it needs      | Returns                                                               |
| --------------- | ------------------ | --------------------------------------------------------------------- |
| `profile`       | steamId            | Steam player summary (persona, avatar, profile URL)                   |
| `games`         | steamId            | Full library (appid, name, playtime, icon)                            |
| `recent`        | steamId [+ count]  | Recently played in last 2 weeks                                       |
| `game`          | appids[]           | Store metadata (type, genres, dev, screenshots)                       |
| `schemas`       | appid              | Achievement definitions per game                                      |
| `achievements`  | steamId + appid    | Earned achievements per game                                          |
| `openid_verify` | params (openid.\*) | `{ steamId, profile }` after Steam's `check_authentication` handshake |

Steam API key is in server-side env var (`STEAM_API_KEY`), never sent from client. `steamId` is passed as option (public info).

`openid_verify` backs the one-click "Sign in through Steam" flow. It re-posts the
`openid.*` params to Steam with `openid.mode=check_authentication` and only trusts
the SteamID64 once Steam answers `is_valid:true` - never trust the callback params
directly, they are trivially forged.

## API (api/epic.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses Epic's undocumented internal REST APIs (same endpoints as Legendary/Playnite). Auth via OAuth authorization code flow with Epic's launcher client credentials embedded in the handler.

| Action         | What it needs                                                               | Returns                                                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`         | authorizationCode or refreshToken                                           | accessToken + refreshToken + accountId + displayName + expiry                                                                                                                                                                                                                |
| `library`      | accessToken [+ epicAccountId] [+ resolveNames]                              | Owned games (auto-paginates) with playtime merged. Each record: `namespace`, `catalogItemId`, `sandboxName`, `appName`, `productId`, `sandboxType`, `acquisitionDate`, `playtime`, `platforms`. `resolveNames: true` calls catalog to replace generic names with real titles |
| `catalog`      | accessToken + items[] ({ namespace, catalogItemId })                        | Store metadata per game: `id`, `title`, `description`, `keyImages`, `developer`, `releaseInfo`, `categories`, `mainGameItem`                                                                                                                                                 |
| `progress`     | accessToken [+ epicAccountId] [+ sandboxIds[]] [+ names{}] [+ resolveNames] | Achievement progress per game: `sandboxId`, `productId`, `sandboxName`, `catalogItemId`, `totalAchievements`, `totalXP`, `totalUnlocked`, `earnedXP`, `achievementSets[]`                                                                                                    |
| `achievements` | accessToken + sandboxId [+ epicAccountId] [+ sandboxName] [+ catalogItemId] | Game header (same fields as progress) + `achievements[]` with `name`, `displayName`, `displayNameLocked`, `iconUnlocked`, `iconLocked`, `XP`, `rarity`, `unlocked`, `unlockDate`, `achievementSetId`, `isBase`                                                               |

### Field identity guide

All Epic identifiers are returned by `library`. Use them as-is - no guessing needed:

| Library field   | Maps to                                                  | Used for                      |
| --------------- | -------------------------------------------------------- | ----------------------------- |
| `namespace`     | `sandboxId` in progress/achievements                     | Achievement queries           |
| `catalogItemId` | `id` in catalog API                                      | Store metadata queries        |
| `sandboxName`   | Human-readable title (e.g. "Fall Guys", "Rocket League") | Display in UI                 |
| `appName`       | Internal codename (e.g. "Sugar", "Jackal")               | Matches playtime `artifactId` |
| `productId`     | `productId` in achievement schema                        | Internal Epic reference       |

**Example flow** - call once, use everywhere:

```
library  records[0].namespace = "jackal"      progress sandboxId: "jackal"
         records[0].catalogItemId = "..."       catalog items: [{ namespace: "jackal", catalogItemId: "..." }]
         records[0].sandboxName = "Dauntless"    pass to progress/achievements via names{} or sandboxName param
```

### `progress` additional options

- **`sandboxIds[]`**: Array of namespaces to check. If omitted, auto-scans the full library.
- **`names{}`**: Optional name map to include game titles in the response. Pass as `{ [sandboxId]: "Game Name" }` or `{ [sandboxId]: { sandboxName, catalogItemId } }`. When auto-scanning, names are filled in automatically from library records.

### `achievements` additional options

- **`sandboxName`**: Optional game name to include in the response.
- **`catalogItemId`**: Optional catalog item ID to include in the response.

Achievement data via `launcher.store.epicgames.com/graphql` (POST only, requires `User-Agent: Mozilla/5.0 (...EpicGamesLauncher)` header). Schema queries are public; player unlock data requires an auth token. Games use Epic's internal codename as their sandboxId (e.g. `jackal` = Dauntless, `9773aa1aa54f4f7b80e44bef04986cea`/Sugar = Rocket League, `50118b7f954e450f8823df1614b24e80` = Fall Guys).

**Auth flow**: User visits `https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code` while logged into Epic in their browser gets a JSON response with an `authorizationCode` (short-lived). Pass that code to the `auth` action. The handler exchanges it for access+refresh tokens using Epic's OAuth endpoint.

No env vars needed - the launcher client id/secret are public (same ones embedded in the Epic Games Launcher binary).

## API (api/xbox.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses Xbox Live REST APIs via OAuth 2.0 through Microsoft account authentication. Auth flow: user visits Microsoft OAuth URL gets authorization code handler exchanges for MSA token Xbox User Token XSTS token. The Xbox app's consumer client ID (`38cd2fa8-66fd-4760-afb2-405eb65d5b0c`) is hardcoded - no Azure app registration needed.

**Auth URL** (user must visit while logged into their Microsoft account):

```
https://login.live.com/oauth20_authorize.srf?client_id=38cd2fa8-66fd-4760-afb2-405eb65d5b0c&response_type=code&approval_prompt=auto&scope=Xboxlive.signin%20Xboxlive.offline_access&redirect_uri=https://login.live.com/oauth20_desktop.srf
```

After authorizing, they're redirected to `oauth20_desktop.srf?code=...`. Pass the `code` param value to the `auth` action.

| Action         | What it needs                         | Returns                                                                                                                                          |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`         | authorizationCode or refreshToken     | xuid + gamertag + userHash + xstsToken + accessToken + refreshToken + expiresIn                                                                  |
| `profile`      | xuid + userHash + xstsToken           | Xbox profile settings (gamertag, gamerscore, avatar)                                                                                             |
| `games`        | xuid + userHash + xstsToken           | Title history - played games with name, titleId, devices, lastTimePlayed, developer, publisher. Playtime (minutesPlayed) merged from userstats.  |
| `achievements` | xuid + userHash + xstsToken + titleId | Full achievement list per titleId (name, description, gamerscore, icon, unlock status, timeUnlocked). `titleId` comes from the `games` response. |

**Limitation**: Xbox's REST API only returns titles that have been started at least once (no full purchase library like Steam). The `games` action mirrors what's available via `titlehub.xboxlive.com` - this is the same limitation Playnite's Xbox integration has.

No env vars needed - the Microsoft OAuth client ID is the Xbox app's consumer ID (same one Playnite uses).

## API (api/ea.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses EA's internal GraphQL API (`service-aggregation-layer.juno.ea.com`) plus the legacy achievements REST API (`achievements.gameservices.ea.com`). Auth via OAuth implicit token flow - user visits EA auth URL while logged into EA in their browser, gets a Bearer access token directly.

**Auth URL** (user must visit while logged into their EA account):

```
https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none
```

Returns `{ access_token, token_type, expires_in }`. Pass the `access_token` value to all actions.

| Action         | What it needs                                                    | Returns                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`         | accessToken                                                      | accessToken + pidId + personaId + displayName                                                                                                                                                             |
| `library`      | accessToken                                                      | Owned games with metadata merged. Each record: `originOfferId`, `productId`, `name`, `gameSlug`, `contentId`, `displayType`, `achievementSetOverride`, `playtimeSeconds`, `lastPlayedDate`                |
| `achievements` | accessToken + personaId + achievementSetOverride [+ sandboxName] | Full achievement list with `name`, `description`, `howTo`, `xp`, `hidden`, `rarity`, `iconUrl`, `unlocked`, `unlockDate`. Uses legacy REST API (icons+descriptions) when available, falls back to GraphQL |

### Field identity guide

| Library field            | Maps to            | Used for                                    |
| ------------------------ | ------------------ | ------------------------------------------- |
| `originOfferId`          | Offer lookup key   | Legacy offers & metadata                    |
| `gameSlug`               | URL slug           | Playtime queries                            |
| `achievementSetOverride` | Achievement set ID | Achievements query (null = no achievements) |
| `contentId`              | Master title ID    | Internal EA reference                       |
| `personaId`              | Player persona ID  | Achievements query (from auth)              |

**Example flow**:

```
auth  { pidId, personaId, displayName }
library  records[0].gameSlug = "fifa-20", achievementSetOverride = "50072_194927_50844"
achievements({ personaId, achievementSetOverride: "50072_194927_50844" })  full achievement list
```

### Auth note

EA access tokens from `ORIGIN_JS_SDK` client ID expire after ~4 hours. There's no refresh flow for this client - user revisits the auth URL for a new token.

## API (api/igdb.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses IGDB v4 (Twitch-backed game database) via OAuth client_credentials flow. No user auth needed - the Twitch Client ID + Client Secret are in server-side env vars (set via `vercel env add` - `.env.local` unreliable on this machine due to iCloud Drive file locking).

| Action        | What it needs                     | Returns                                                                                                                                                                                                                |
| ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`        | nothing                           | `{ accessToken, expiresAt }` - Twitch OAuth token (auto-refreshed in-memory)                                                                                                                                           |
| `search`      | query [+ limit=10] [+ type]       | Array of games matching the search term. Fields: name, slug, summary, game_type, cover.url (t_1080p), platforms (name + abbreviation), release_dates (date, platform, region, human). `type` filters by game_type enum |
| `game`        | ids (single int or array of ints) | Array of full game records by IGDB id. `external_games` bundled in response with `source` name (enriched from numeric ID). See [game response fields](api_reference.md#game) in api_reference.md.                      |
| `by_external` | source + uid                      | Lightweight lookup: `{ id }` (IGDB game ID) or `null`. Use `game(id)` for full record. `source` accepts name or number.                                                                                                |

**Source map** - maps names to IGDB's `external_game_source` IDs. Used by `by_external` and baked into `game` response via `external_games[].source`:

| Name        | ID  |
| ----------- | --- |
| steam       | 1   |
| giantbomb   | 3   |
| gog         | 5   |
| youtube     | 10  |
| microsoft   | 11  |
| apple       | 13  |
| twitch      | 14  |
| android     | 15  |
| amazon      | 20  |
| amazon_luna | 22  |
| amazon_adg  | 23  |
| epic        | 26  |
| oculus      | 28  |
| utomik      | 29  |
| itch        | 30  |
| xbox        | 31  |
| kartridge   | 32  |
| psn         | 36  |
| focus       | 37  |
| xgpc        | 54  |
| gamejolt    | 55  |
| igdb        | 121 |

**Rate limit**: 4 requests/second to IGDB (handled by the API itself - no client-side throttle needed for single-user use).

The `search` action accepts an optional `type` parameter to filter results by game_type (e.g. `{"query":"Elden Ring","type":0}` returns only main games).

## API (api/sgdb.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses SteamGridDB v2 API (community-driven game artwork: grids, heroes, logos). Auth via static API key (`STEAMGRIDDB_API_KEY` in Vercel env), sent as `Authorization: Bearer` header. No OAuth, no token refresh.

Asset actions default to including everything (nsfw/humor/epilepsy/animated). Override via optional filters: `styles`, `dimensions`, `mimes`, `types` (static/animated), `nsfw` (yes/no/any), `humor` (yes/no/any), `epilepsy` (yes/no/any), `limit`, `page`. Styles/dimensions values differ per asset type (see SGDB docs for valid values).

Each action accepts either an SGDB `gameId` or a `{ platform, platformId }` pair for direct platform ID lookups. Platform enum: `steam`, `origin`, `egs`, `bnet`, `uplay`, `flashpoint`, `eshop`.

| Action   | Params                                        | Returns                                                                              |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `search` | name                                          | [{ id, name, release_date }]                                                         |
| `game`   | sgdbId or { platform, platformId }            | { id, name, release_date }                                                           |
| `grids`  | sgdbId or { platform, platformId } [+filters] | { page, total, limit, data: [{ id, width, height, nsfw, humor, mime, url, thumb }] } |
| `heroes` | sgdbId or { platform, platformId } [+filters] | Same shape as grids                                                                  |
| `logos`  | sgdbId or { platform, platformId } [+filters] | Same shape as grids (logos have no `dimensions` filter)                              |

For platforms without a direct SGDB bridge (PSN, Xbox, EA), use IGDB as intermediary: `game(igdbId).external_games` find steam entry SGDB steam bridge. Name search is final fallback.

> Detailed API responses, field observations, data flows, and sync patterns for all handlers are in [`api_reference.md`](api_reference.md).

## Database

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

## App auth & credential vault

The app is a private, single-owner tool deployed publicly. Two independent gates enforce that.

### Gate 1 - who can sign in

Supabase Auth with the **Google provider only**. Sign-in is locked by a `before insert` trigger on `auth.users` (`public.enforce_owner_allowlist`):

- If the email is in `public.owner_allowlist`, allow.
- Else if `auth.users` is empty, allow **and record that email as the owner** (first signup claims the app).
- Else `raise exception 'signup is closed'`.

Owner is `fssmoura.fm@gmail.com`. To authorise a second identity, insert it into `owner_allowlist` via SQL - there is no UI for this, and `owner_allowlist` has RLS on with **no policies**, so it is unreachable from any client key.

### Gate 2 - who can call /api/\*

`api/_auth.js` exports `requireUser(req, res)`. Every handler calls it immediately after the CORS preflight and before parsing the body:

```js
setCorsHeaders(req, res);
if (handlePreflight(req, res)) return;
const user = await requireUser(req, res);
if (!user) return;
```

It reads the bearer token from `Authorization`, falling back to `access_token` in the query/body (so endpoints can be tested by pasting a URL into a browser). It verifies against `${SUPABASE_URL}/auth/v1/user`, caches valid tokens in memory for 60s, and returns **403** if `OWNER_USER_ID` is set and does not match.

Without this, anyone could hit the deployed endpoints and burn `STEAM_API_KEY` / `TWITCH_CLIENT_SECRET` / `STEAMGRIDDB_API_KEY` quota.

Required env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OWNER_USER_ID`. Note `_cors.js` allows the `Authorization` request header - do not remove it.

### `platform_credentials` table

Cross-device token store, one row per `(user_id, platform)`. RLS scopes every operation to `auth.uid()`; `anon` has no grants at all.

| Column               | Notes                                                 |
| -------------------- | ----------------------------------------------------- |
| `user_id`            | uuid, defaults to `auth.uid()`, FK `auth.users`       |
| `platform`           | check: `psn` / `steam` / `epic` / `xbox` / `ea`       |
| `credentials`        | jsonb - tokens needed to call the handler             |
| `identity`           | jsonb - `{ name, accountId }` for display             |
| `expires_at`         | timestamptz, normalized by the client (see below)     |
| `refresh_expires_at` | timestamptz, null when the platform offers no refresh |

> **Table-level `GRANT`s are required.** This project has no default privileges for `authenticated`, so RLS policies alone produce `42501 permission denied` - Postgres checks privileges _before_ policies. Any new table needs an explicit `grant ... to authenticated`.

### Expiry normalization

Every platform reports expiry differently. `public/js/platforms.js` normalizes all of them into `expires_at`:

| Platform | Raw response                        | Normalized                    |
| -------- | ----------------------------------- | ----------------------------- |
| PSN      | `accessTokenExpiry` (ISO)           | used directly                 |
| Epic     | `expires_at` / `refresh_expires_at` | used directly                 |
| Xbox     | `expiresIn` seconds only            | `now + expiresIn`             |
| EA       | nothing at all                      | assumed `now + 4h`            |
| Steam    | n/a                                 | `null` + `neverExpires: true` |

Two platform quirks the client compensates for, both easy to regress:

- **Xbox refresh rotates `xstsToken` AND `userHash`**, not just the token. The whole tuple is re-persisted on every refresh or subsequent calls 401.
- **Epic burns a token refresh** resolving the account id if `epicAccountId` is omitted, so `callCredentials` always sends it.

`public/js/api.js` also absorbs the one handler inconsistency: **psn.js reads credentials from the top level of the body; every other handler expects them nested in `options`.**

### Connect flows (how a credential is captured)

Two modes, forced by the browser's same-origin policy - a popup on another
domain cannot have its URL or body read by us.

| Platform | Mode        | Why                                                                                                                |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Steam    | `openid`    | Steam OpenID 2.0 accepts an arbitrary `return_to`, so the popup redirects back to **our** origin. Fully automatic. |
| PSN      | `clipboard` | `ssocookie` renders JSON on Sony's domain. Unreadable cross-origin.                                                |
| Epic     | `clipboard` | `id/api/redirect` renders JSON on Epic's domain.                                                                   |
| EA       | `clipboard` | Implicit grant renders JSON at `nucleus:rest`.                                                                     |
| Xbox     | `clipboard` | Redirect URI is `login.live.com/oauth20_desktop.srf`, which we don't own.                                          |

**Steam (`openid`)**: `connect.js` builds the OpenID URL with
`return_to = <origin>/steam-callback.html`. That bare page postMessages the
`openid.*` params to `window.opener` and closes. The parent then calls
`steam.openid_verify`, which does the mandatory `check_authentication` handshake
with Steam server-side before trusting the SteamID64 - never trust the callback
params directly.

**Everything else (`clipboard`)**: the popup opens the credential URL (already
authenticated, so the JSON renders immediately), a modal appears, and
`awaitClipboardCredential` polls `navigator.clipboard.readText()` on window
focus. The moment the clipboard parses into a valid credential it connects and
closes the popup. Clipboard permission can be denied, so the modal **always**
keeps a manual paste field - do not remove it.

`public/js/credentials.js` holds the pure extractors (no imports, unit-testable).
Each accepts JSON, a full redirect URL, or the bare value, and returns `null`
when the text isn't a credential - that `null` is what makes clipboard polling
keep waiting instead of connecting with garbage.

**To make Xbox fully automatic**, register your own Azure app with
`<origin>/xbox-callback.html` as a redirect URI and swap `XBOX_CLIENT_ID` in
`api/xbox.js`. PSN, Epic and EA cannot be automated from a browser at all.

### Auto-refresh

`public/js/refresh.js` keeps tokens alive so you don't reconnect constantly. A
platform is refreshed when under **10 minutes** remain, checked on app boot,
every 4 minutes, on tab focus, and lazily before any API console call.

| Platform | Auto-refresh | Reconnect needed when                      |
| -------- | ------------ | ------------------------------------------ |
| PSN      | yes          | refresh token expires (~10 days idle)      |
| Epic     | yes          | refresh token expires (~1 year)            |
| Xbox     | yes          | MSA refresh token expires                  |
| Steam    | n/a          | never                                      |
| EA       | **no**       | every ~4h - `ORIGIN_JS_SDK` has no refresh |

A failed refresh is memoized in a `failed` set so a dead refresh token isn't
retried every tick; `clearFailure(id)` is called after a manual reconnect.

This only runs while a tab is open. A server-side sync job needs its own refresh pass.

**EA auth URL MUST include `prompt=none`, and EA is a two-step connect.**
`ORIGIN_JS_SDK` is a JS-SDK client that is only permitted to mint a token from
an _existing_ ea.com session. Driving an interactive login through it fails with
"Your request cannot be completed. Service limitations apply." So the flow is:
sign in at `www.ea.com/login` first (`loginUrl`), then hit the authorize URL with
`prompt=none`, which returns the token silently. Removing `prompt=none` breaks it.

### Scheduled refresh (the thing that survives the app being closed)

`refresh.js` only runs in an open tab, so it cannot stop a refresh token lapsing
while the app is unused. `api/cron-refresh.js` closes that gap: a Vercel Cron
hits it daily at 03:00 UTC, it reads `platform_credentials` with the **service
role key** (bypassing RLS), and rolls PSN / Epic / Xbox refresh tokens forward
unconditionally. Steam and EA land in `skipped`.

It authenticates via `Authorization: Bearer ${CRON_SECRET}` - **not** the owner
JWT gate, since the caller is a machine. It always responds 200 (with per-row
detail in the body) so a single platform failing doesn't mark the cron failed,
and it never logs token values.

Refresh logic lives in `api/_platform-refresh.js`, duplicated from the handlers
because they only export a request handler. **If you change the token mapping in
`psn.js` / `epic.js` / `xbox.js`, change it here too.**

Vercel Hobby only allows daily cron granularity. That is sufficient: the job
exists to roll the long-lived _refresh_ token (PSN ~10 days), not the short
access token.

Extra env: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never shipped
to the browser).

### Mobile

Popups are unreliable on mobile, so `connect.js` switches to a **full-page
redirect** when `(pointer: coarse)` or the viewport is 820px. iOS Safari's
transient-activation window is so short that any `await` between the tap and
`window.open()` breaks it, and MSAL/Auth0/Supabase all recommend redirects for
mobile web. A same-tab `location.href` assignment cannot be popup-blocked.

The redirect stores `{ platform, state, createdAt }` in **both** sessionStorage
and localStorage (iOS can evict a backgrounded tab), validates the `state` nonce
and a 10-minute TTL on return, and cleans the URL with `replaceState` so the
credential never enters history. Resume runs inside `connections.mount()`, i.e.
**after** the Supabase session is restored - otherwise the verify call 401s.

**Clipboard auto-capture does not work on iOS Safari or Firefox** and never
will: a `focus` event isn't transient user activation, cross-origin clipboard
content always triggers the paste prompt, switching tabs rejects the pending
promise, and neither browser will support the `clipboard-read` permission. The
manual paste field is the _only_ path there - it is not a nicety.

## Frontend

`public/` is a vanilla ES-module SPA. No bundler, no framework, no build step -
the browser loads the files as written, so editing them is immediate.

Two tabs behind a Google login gate:

- **Connections** - one row per platform: status dot, account name, expiry
  state, and buttons for connect / refresh / edit / delete. `edit` expands the
  stored record as editable JSON, so credentials can be inspected or corrected
  by hand.
- **API console** - pick a platform + action and the console builds a labelled
  form from `public/js/schemas.js`: one input per option the action accepts,
  with required markers, defaults, example values and a one-line explanation.
  Stored credentials are injected automatically and never appear as fields.
  An "edit as JSON" toggle drops back to a raw options box for anything the
  schema doesn't cover. IGDB and SGDB appear here too; they need no credentials.

  **`schemas.js` must be kept in step with the handlers.** If you add an action
  or an option, add it there too, or the console silently can't reach it. The
  field `name` must match the key the handler reads from `options`.

### Styling rules (deliberate, keep them)

All CSS lives in `public/css/app.css`, numbered into ten sections with a guide
at the top. Two rules make it safe to restyle later without touching logic:

1. **No inline styles anywhere.** JavaScript writes class names only, never
   `style="..."`. An inline style would silently beat any rule in the
   stylesheet, so this keeps the CSS file authoritative.
2. **Colours only via the `:root` variables.** Changing `--bg` / `--text` /
   `--line` recolours the whole app at once.

Styling is intentionally wireframe-only: grayscale, no branding. Build
functionality first, design later. Do not add colour or polish unless asked.

## Git

- `main` = production (auto-deploys to Vercel), `feat/*` = active dev
- Rebase feature branches (no merge commits)
- Conventional Commits: `feat:`, `chore:`, `refactor:`, etc. - lowercase after prefix, present tense imperative
