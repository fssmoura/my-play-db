# my-play-db

Personal game library — pulls PSN (and eventually other platforms) data into one place.

This is not a public service. It's a private data pipe. The API layer has zero business logic, no database, no merging. It maps 1:1 to what the source provides so a sync script or frontend can decide what to store and how.

## Dev

- **`vercel dev`** — local server at localhost:3000 (only way to test API functions). Do NOT use VS Code Live Server.
- **`npx prettier --write <file>`** — formatting. No linter, no test framework, no build step configured.

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
auth ✅ — returns access_token, refresh_token, account_id
```

## Stack

- **CommonJS** everywhere (api/). `require()`, not `import`. package.json has no `"type": "module"` — psn-api is CJS.
- **Vanilla JS frontend** (public/) — ES modules in browser, no bundler, no framework, no TypeScript.
- **Dependencies**: `psn-api` ^2.14.0. Steam, Epic, and IGDB handlers use raw `fetch`.

## Architecture

```
Browser (ES module) → POST /api/psn   → Vercel serverless → psn-api → PlayStation Network
                    → POST /api/steam → Vercel serverless → fetch   → Steam Web API
                    → POST /api/epic  → Vercel serverless → https   → Epic internal APIs
                    → POST /api/ea    → Vercel serverless → https   → EA GraphQL + REST APIs
                    → POST /api/igdb  → Vercel serverless → https   → IGDB v4 (Twitch-backed)
```

```
my-play-db/
├── api/
│   ├── _cors.js       # CORS utility
│   ├── psn.js         # PSN handler — 7 actions
│   ├── steam.js       # Steam handler — 6 actions
│   ├── epic.js        # Epic handler — 5 actions
│   ├── xbox.js        # Xbox handler — 4 actions
│   ├── ea.js          # EA handler — 3 actions
│   └── igdb.js        # IGDB handler — 4 actions
├── public/
│   ├── index.html     # NPSSO link
├── .env.local          # STEAM_API_KEY (local dev)
├── package.json
└── vercel.json
```

## API (api/psn.js)

POST or GET with `{ npsso, accessToken, refreshToken, action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

GET query params are parsed with `JSON.parse` where possible — numbers, booleans, arrays, and objects in query strings must be valid JSON. Plain strings pass through as-is.

| Action      | What it needs                                   | Returns                                                                                                                 |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `auth`      | npsso or refreshToken                           | accessToken + refreshToken + expiry                                                                                     |
| `profile`   | accessToken                                     | profile + presence + trophy summary                                                                                     |
| `games`     | accessToken [+ limit/offset]                    | played games (auto-paginates, ps4/ps5/pspc). `limit` returns N most recent                                              |
| `titles`    | accessToken [+ limit/offset]                    | trophy-focused title list (auto-paginates, page size 800). npCommunicationId + lastUpdatedDateTime + progress per title |
| `recent`    | accessToken [+ limit/categories]                | recently played games (lightweight GraphQL, no pagination). Default limit 50.                                           |
| `trophymap` | accessToken + titleIds[]                        | npTitleId → { npCommunicationId, npServiceName }. Falls back to proxy account for titles the user never synced.         |
| `trophies`  | accessToken + npCommunicationId + npServiceName | full trophy details for one game. If the user hasn't synced the game, returns definitions with all `earned: false`.     |

Auth order: NPSSO → exchangeNpssoForAccessCode → exchangeAccessCodeForAuthTokens. The `auth` action is handled before the generic authorization path — do not change this order.

## API (api/steam.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

| Action         | What it needs     | Returns                                             |
| -------------- | ----------------- | --------------------------------------------------- |
| `profile`      | steamId           | Steam player summary (persona, avatar, profile URL) |
| `games`        | steamId           | Full library (appid, name, playtime, icon)          |
| `recent`       | steamId [+ count] | Recently played in last 2 weeks                     |
| `game`         | appids[]          | Store metadata (type, genres, dev, screenshots)     |
| `schemas`      | appid             | Achievement definitions per game                    |
| `achievements` | steamId + appid   | Earned achievements per game                        |

Steam API key is in server-side env var (`STEAM_API_KEY`), never sent from client. `steamId` is passed as option (public info).

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

All Epic identifiers are returned by `library`. Use them as-is — no guessing needed:

| Library field   | Maps to                                                   | Used for                      |
| --------------- | --------------------------------------------------------- | ----------------------------- |
| `namespace`     | `sandboxId` in progress/achievements                      | Achievement queries           |
| `catalogItemId` | `id` in catalog API                                       | Store metadata queries        |
| `sandboxName`   | Human-readable title (e.g. "Fall Guys", "Rocket League®") | Display in UI                 |
| `appName`       | Internal codename (e.g. "Sugar", "Jackal")                | Matches playtime `artifactId` |
| `productId`     | `productId` in achievement schema                         | Internal Epic reference       |

**Example flow** — call once, use everywhere:

```
library → records[0].namespace = "jackal"     → progress sandboxId: "jackal"
         records[0].catalogItemId = "..."      → catalog items: [{ namespace: "jackal", catalogItemId: "..." }]
         records[0].sandboxName = "Dauntless"   → pass to progress/achievements via names{} or sandboxName param
```

### `progress` additional options

- **`sandboxIds[]`**: Array of namespaces to check. If omitted, auto-scans the full library.
- **`names{}`**: Optional name map to include game titles in the response. Pass as `{ [sandboxId]: "Game Name" }` or `{ [sandboxId]: { sandboxName, catalogItemId } }`. When auto-scanning, names are filled in automatically from library records.

### `achievements` additional options

- **`sandboxName`**: Optional game name to include in the response.
- **`catalogItemId`**: Optional catalog item ID to include in the response.

Achievement data via `launcher.store.epicgames.com/graphql` (POST only, requires `User-Agent: Mozilla/5.0 (...EpicGamesLauncher)` header). Schema queries are public; player unlock data requires an auth token. Games use Epic's internal codename as their sandboxId (e.g. `jackal` = Dauntless, `9773aa1aa54f4f7b80e44bef04986cea`/Sugar = Rocket League, `50118b7f954e450f8823df1614b24e80` = Fall Guys).

**Auth flow**: User visits `https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code` while logged into Epic in their browser → gets a JSON response with an `authorizationCode` (short-lived). Pass that code to the `auth` action. The handler exchanges it for access+refresh tokens using Epic's OAuth endpoint.

No env vars needed — the launcher client id/secret are public (same ones embedded in the Epic Games Launcher binary).

## API (api/xbox.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses Xbox Live REST APIs via OAuth 2.0 through Microsoft account authentication. Auth flow: user visits Microsoft OAuth URL → gets authorization code → handler exchanges for MSA token → Xbox User Token → XSTS token. The Xbox app's consumer client ID (`38cd2fa8-66fd-4760-afb2-405eb65d5b0c`) is hardcoded — no Azure app registration needed.

**Auth URL** (user must visit while logged into their Microsoft account):

```
https://login.live.com/oauth20_authorize.srf?client_id=38cd2fa8-66fd-4760-afb2-405eb65d5b0c&response_type=code&approval_prompt=auto&scope=Xboxlive.signin%20Xboxlive.offline_access&redirect_uri=https://login.live.com/oauth20_desktop.srf
```

After authorizing, they're redirected to `oauth20_desktop.srf?code=...`. Pass the `code` param value to the `auth` action.

| Action         | What it needs                         | Returns                                                                                                                                          |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`         | authorizationCode or refreshToken     | xuid + gamertag + userHash + xstsToken + accessToken + refreshToken + expiresIn                                                                  |
| `profile`      | xuid + userHash + xstsToken           | Xbox profile settings (gamertag, gamerscore, avatar)                                                                                             |
| `games`        | xuid + userHash + xstsToken           | Title history — played games with name, titleId, devices, lastTimePlayed, developer, publisher. Playtime (minutesPlayed) merged from userstats.  |
| `achievements` | xuid + userHash + xstsToken + titleId | Full achievement list per titleId (name, description, gamerscore, icon, unlock status, timeUnlocked). `titleId` comes from the `games` response. |

**Limitation**: Xbox's REST API only returns titles that have been started at least once (no full purchase library like Steam). The `games` action mirrors what's available via `titlehub.xboxlive.com` — this is the same limitation Playnite's Xbox integration has.

No env vars needed — the Microsoft OAuth client ID is the Xbox app's consumer ID (same one Playnite uses).

## API (api/ea.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses EA's internal GraphQL API (`service-aggregation-layer.juno.ea.com`) plus the legacy achievements REST API (`achievements.gameservices.ea.com`). Auth via OAuth implicit token flow — user visits EA auth URL while logged into EA in their browser, gets a Bearer access token directly.

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
auth → { pidId, personaId, displayName }
library → records[0].gameSlug = "fifa-20", achievementSetOverride = "50072_194927_50844"
achievements({ personaId, achievementSetOverride: "50072_194927_50844" }) → full achievement list
```

### Auth note

EA access tokens from `ORIGIN_JS_SDK` client ID expire after ~4 hours. There's no refresh flow for this client — user revisits the auth URL for a new token.

## API (api/igdb.js)

POST or GET with `{ action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

Uses IGDB v4 (Twitch-backed game database) via OAuth client_credentials flow. No user auth needed — the Twitch Client ID + Client Secret are in server-side env vars (set via `vercel env add` — `.env.local` unreliable on this machine due to iCloud Drive file locking).

| Action        | What it needs                     | Returns                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`        | nothing                           | `{ accessToken, expiresAt }` — Twitch OAuth token (auto-refreshed in-memory)                                                                                                                                                                                              |
| `search`      | query [+ limit=10] [+ type]       | Array of games matching the search term. Fields: name, slug, summary, first_release_date, cover.url (t_1080p), genres.name, platforms.abbreviation, involved_companies, game_type. `type` filters by game_type enum                                                       |
| `game`        | ids (single int or array of ints) | Array of full game records by IGDB id. See [game response fields](#game-response-fields) below.                                                                                                                                                                           |
| `by_external` | source + uid                      | Single game record by external source ID (e.g. Steam appid → IGDB game). Returns `null` if not found. **LIMITATION**: numeric uids (Steam appids) fail — IGDB parsercalypse converts `"1817070"` to integer, causing `expected String but found Integer`. See workaround. |

**Source map** for `by_external`:

| Name  | Category |
| ----- | -------- |
| steam | 1        |
| gog   | 5        |
| xbox  | 31       |
| psn   | 36       |
| epic  | 26       |

**Rate limit**: 4 requests/second to IGDB (handled by the API itself — no client-side throttle needed for single-user use).

### Game response fields

The `game` action returns games with images/videos URLs auto-constructed server-side:

| Field                   | Type                                                           | Description                                        |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `id`                    | int                                                            | IGDB's canonical game ID                           |
| `name`                  | string                                                         | Game title                                         |
| `slug`                  | string                                                         | URL-friendly identifier                            |
| `summary`               | string                                                         | Short description                                  |
| `storyline`             | string                                                         | Full plot summary                                  |
| `game_type`             | int                                                            | Game type enum (see table below)                   |
| `version_title`         | string                                                         | Edition/subtitle (e.g. "Game of the Year Edition") |
| `rating`                | float                                                          | IGDB community rating (0-100)                      |
| `rating_count`          | int                                                            | Number of ratings                                  |
| `updated_at`            | timestamp                                                      | Last update timestamp                              |
| `cover`                 | object `{ url }`                                               | Cover image (t_1080p)                              |
| `screenshots[]`         | array of `{ url }`                                             | Screenshots (t_1080p)                              |
| `artworks[]`            | array of `{ url }`                                             | Artworks (t_1080p)                                 |
| `videos[]`              | array of `{ name, url }`                                       | Video trailers (YouTube URLs)                      |
| `genres[]`              | array of `{ id, name }`                                        | Genres                                             |
| `platforms[]`           | array of `{ id, name, abbreviation }`                          | Platforms                                          |
| `involved_companies[]`  | array of `{ id, company: { id, name }, developer, publisher }` | Dev/publisher                                      |
| `release_dates[]`       | array of `{ id, date, platform, region, human }`               | Per-platform releases                              |
| `websites[]`            | array of `{ id, url }`                                         | External links (category not returned by IGDB)     |
| `collections[]`         | array of `{ id, name }`                                        | Collections (e.g. "Marvel's Spider-Man")           |
| `franchise`             | object `{ id, name }`                                          | Franchise (e.g. "Spider-Man")                      |
| `parent_game`           | object `{ id, name, slug, game_type }`                         | Parent game (for DLCs, remasters, etc)             |
| `version_parent`        | object `{ id, name, slug, game_type }`                         | Parent version (for editions/bundles)              |
| `bundles`               | int[]                                                          | IDs of bundles this game is included in            |
| `dlcs`                  | int[]                                                          | IDs of DLC content for this game                   |
| `expanded_games`        | int[]                                                          | IDs of expanded games                              |
| `expansions`            | int[]                                                          | IDs of expansions                                  |
| `forks`                 | int[]                                                          | IDs of forks                                       |
| `ports`                 | int[]                                                          | IDs of ports                                       |
| `remakes`               | int[]                                                          | IDs of remakes                                     |
| `remasters`             | int[]                                                          | IDs of remasters                                   |
| `standalone_expansions` | int[]                                                          | IDs of standalone expansions                       |
| `similar_games`         | int[]                                                          | IDs of similar games (max 10-11)                   |

Image URL construction pattern: `https://images.igdb.com/igdb/image/upload/t_1080p/{image_id}.jpg`

Video URL pattern: `https://www.youtube.com/watch?v={video_id}`

No `first_release_date` — use earliest from `release_dates[]` instead.

### Relationship mapping

Relationships are **directional** — child→parent has full names, parent→child is bare IDs:

```
Parent game (19565) → DLC IDs [109421, 109419, 109422]  (bare)
DLC "Turf Wars" → parent_game { id: 19565, name: "Marvel's Spider-Man", ... }  (full)

Parent game → bundle/edition IDs [122095]  (bare)
GOTY Edition → version_parent { id: 19565, name: "Marvel's Spider-Man", ... }  (full)
```

**Editions and Updates are NOT returned by the parent game** — only discoverable via reverse queries:

- Editions (games with `version_parent` pointing to parent): `where version_parent = {parent_id}`
- Updates (games with `parent_game` + `game_type = 14`): `where parent_game = {parent_id} & game_type = 14`

### Game type enum

| Value | Name                 |
| ----- | -------------------- |
| 0     | main_game            |
| 1     | dlc_addon            |
| 2     | expansion            |
| 3     | bundle               |
| 4     | standalone_expansion |
| 5     | mod                  |
| 6     | episode              |
| 7     | season               |
| 8     | remake               |
| 9     | remaster             |
| 10    | expanded_game        |
| 11    | port                 |
| 12    | fork                 |
| 13    | pack                 |
| 14    | update               |

The `search` action accepts an optional `type` parameter to filter results by game_type (e.g. `{"query":"Elden Ring","type":0}` returns only main games).

### Known limitations

- **`by_external` numeric uid**: IGDB APIcalypse parser converts all-digit quoted strings (like `"1817070"`) to integers. The `uid` field on `external_games` expects String — this causes a 400 error for Steam appids. Workaround: query `where version_parent = null & category = 0` then filter client-side, or use the `websites` endpoint with URL matching (also blocked by `://` in URLs). Non-numeric uids (Epic hex strings) work fine.
- **`websites.category` not returned**: IGDB no longer returns the `category` field on website records. Identify site type by parsing URL domain.

## Sync workflow

The API is designed to support two patterns:

**Initial sync** — pull everything once:

```
auth → profile → games (no limit) → titles (no limit) → trophies per game
```

**Incremental update** — only fetch what changed:

```
auth (via refreshToken) → recent({ limit: 20 }) → compare lastPlayedDateTime
                        → titles({ limit: 50 }) → compare lastUpdatedDateTime
                        → trophies only for changed titles
```

`games` with a `limit` provides playtime data (playDuration, playCount) for the N most recently played. `recent` is a lighter alternative (GraphQL endpoint, no pagination, no playtime) when you only need to detect "was this game played since last check?" without fetching the heavier `games` response.

`titles` returns every trophy-enabled title ordered by most recent trophy activity. Each entry includes `npCommunicationId`, `progress`, `definedTrophies`, `earnedTrophies`, and `lastUpdatedDateTime` — enough to decide whether `trophies` needs to be called for that game.

**Epic sync** — library + achievements:

```
auth (via refreshToken) → library({ resolveNames: true }) → compare acquisitionDate
                        → catalog only for new/changed items
                        → progress({ resolveNames: true }) → achievements only for games with new unlocks
```

`library` includes playtime (seconds) merged into each record. Incremental detection: compare `playtime` against previous run to detect recently-played games. No "last played" timestamp exists in Epic's API. `progress` checks all library namespaces for achievement schemas (public, no auth), then fetches player unlock data. Use `achievements` to get full details per game. `catalogItemId` + `namespace` from library records serve as the lookup keys for `catalog` queries — no guessing needed. Pass `resolveNames: true` on `library` and `progress` to resolve generic sandbox names ("Live", "shoal Production") into real titles via the catalog API.

**Xbox sync** — title history + achievements:

```
auth (via refreshToken) → profile → games → compare lastTimePlayed per title
                                      → achievements only for titles where lastTimePlayed changed
```

`games` returns all played titles (auto-paginates), each with `titleHistory.lastTimePlayed` and minutes played where available. Metadata is included in the `detail` field per title: `developerName`, `publisherName`, `description`, `shortDescription`, `releaseDate`, `genres`, `displayImage`. No separate catalog endpoint needed. Games without `XblAchievements` in `detail.attributes` have no achievements to fetch. Playtime (`minutesPlayed`) is only available for Microsoft Store / Xbox-native titles (UWP, Game Pass) — non-MS games (Riot, Steam, standalone) that appear via Xbox app tracking on PC will show `minutesPlayed: null` or `0`.

**Incremental detection**: Compare `lastTimePlayed` against stored timestamps. Titles where it's newer need re-import; titles with `null` or old timestamps can be skipped. Achievement data is per-game via `achievements` action.

**EA sync** — library + achievements:

```
auth → library → compare playtime per game
               → achievements only for games with changed playtime
```

`library` includes playtime (seconds) and `lastPlayedDate` merged into each record. Incremental detection: compare `playtimeSeconds` against previous run to find recently-played games. Each library record includes `achievementSetOverride` — games with `null` have no achievements. `gameSlug` from library is the key for playtime lookups; `achievementSetOverride` is the key for achievements. Older games (Origin era) return achievement icons, descriptions, and rarity via the legacy REST API; newer games fall back to GraphQL (name + status only).

## Frontend

`public/index.html` shows the NPSSO link. No JavaScript frontend exists — the API is consumed by a sync script or future UI.

## Git

- `main` = production (auto-deploys to Vercel), `feat/*` = active dev
- Rebase feature branches (no merge commits)
- Conventional Commits: `feat:`, `chore:`, `refactor:`, etc. — lowercase after prefix, present tense imperative
