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
- **Dependencies**: `psn-api` ^2.14.0. Steam and Epic handlers use raw `fetch`.

## Architecture

```
Browser (ES module) → POST /api/psn   → Vercel serverless → psn-api → PlayStation Network
                    → POST /api/steam → Vercel serverless → fetch   → Steam Web API
                    → POST /api/epic  → Vercel serverless → https   → Epic internal APIs
```

```
my-play-db/
├── api/
│   ├── _cors.js       # CORS utility
│   ├── psn.js         # PSN handler — 7 actions
│   ├── steam.js       # Steam handler — 6 actions
│   └── epic.js        # Epic handler — 5 actions
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

## Frontend

`public/index.html` shows the NPSSO link. No JavaScript frontend exists — the API is consumed by a sync script or future UI.

## Git

- `main` = production (auto-deploys to Vercel), `feat/*` = active dev
- Rebase feature branches (no merge commits)
- Conventional Commits: `feat:`, `chore:`, `refactor:`, etc. — lowercase after prefix, present tense imperative
