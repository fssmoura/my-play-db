# my-play-db

Personal game library — pulls PSN (and eventually other platforms) data into one place.

This is not a public service. It's a private data pipe. The API layer has zero business logic, no database, no merging. It maps 1:1 to what the source provides so a sync script or frontend can decide what to store and how.

## Dev

- **`vercel dev`** — local server at localhost:3000 (only way to test API functions). Do NOT use VS Code Live Server.
- **`npx prettier --write <file>`** — formatting. No linter, no test framework, no build step configured.

## Stack

- **CommonJS** everywhere (api/). `require()`, not `import`. package.json has no `"type": "module"` — psn-api is CJS.
- **Vanilla JS frontend** (public/) — ES modules in browser, no bundler, no framework, no TypeScript.
- Single dependency: `psn-api` ^2.14.0.

## Architecture

```
Browser (ES module) → POST /api/psn → Vercel serverless → psn-api → PlayStation Network
```

```
my-play-db/
├── api/
│   ├── _cors.js       # CORS utility
│   └── psn.js         # PSN handler — 7 actions
├── public/
│   ├── index.html     # NPSSO link
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

## Frontend

`public/index.html` shows the NPSSO link. No JavaScript frontend exists — the API is consumed by a sync script or future UI.

## Git

- `main` = production (auto-deploys to Vercel), `feat/*` = active dev
- Rebase feature branches (no merge commits)
- Conventional Commits: `feat:`, `chore:`, `refactor:`, etc. — lowercase after prefix, present tense imperative
