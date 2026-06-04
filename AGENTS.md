# my-play-db

Personal game library — aggregates data from PSN (and eventually more platforms).

## Dev

- **`vercel dev`** — local server at localhost:3000 (only way to test API functions). Do NOT use VS Code Live Server.
- **`npx prettier --write <file>`** — formatting. No linter, no test framework, no build step configured.

## Stack quirks

- **CommonJS** everywhere (api/). `require()`, not `import`. package.json has no `"type": "module"` — psn-api is CJS.
- **Vanilla JS frontend** (public/) — ES modules in browser, no bundler, no framework, no TypeScript.
- Single dependency: `psn-api` ^2.14.0.

## Architecture

Browser (ES module) → POST /api/psn → Vercel serverless → psn-api → PlayStation Network

```
my-play-db/
├── api/
│   ├── _cors.js     # CORS utility (setCorsHeaders, handlePreflight)
│   └── psn.js       # PSN handler — 7 actions
├── public/
│   ├── index.html   # NPSSO input form
├── package.json
└── vercel.json      # { "outputDirectory": "public" }
```

## API (api/psn.js)

POST or GET with `{ npsso, accessToken, refreshToken, action, options }`. CORS whitelisted to localhost:3000 and my-play-db.vercel.app.

| Action      | What it needs                                   | Returns                                                                    |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `auth`      | npsso or refreshToken                           | accessToken + refreshToken + expiry                                        |
| `profile`   | accessToken                                     | profile + presence + trophy summary                                        |
| `games`     | accessToken [+ limit/offset]                    | played games (auto-paginates, ps4/ps5/pspc). `limit` returns N most recent |
| `trophymap` | accessToken + titleIds[]                        | npTitleId → { npCommunicationId, npServiceName }                           |
| `trophies`  | accessToken + npCommunicationId + npServiceName | full trophy details for one game                                           |

Auth: NPSSO → exchangeNpssoForAccessCode → exchangeAccessCodeForAuthTokens. The `auth` action is handled before the generic authorization path — do not change this order.

`trophymap` falls back to a proxy account (id hardcoded at `api/psn.js`) for titles the user never earned trophies on.

The `trophies` action handles missing trophy sync gracefully — if the user has never synced a game, it returns trophy definitions with all `earned: false` rather than crashing.

## Frontend gap

`public/js/main.js` + `public/js/api/client.js` + `public/js/api/psn/index.js` are referenced by index.html but **do not exist**. Frontend is non-functional.

## Git

- `main` = production (auto-deploys to Vercel), `feat/*` = active dev
- Rebase feature branches (no merge commits)
- Conventional Commits: `feat:`, `chore:`, `refactor:`, etc. — lowercase after prefix, present tense imperative

## Stale

`.gitignore` has Firebase entries leftover from an earlier hosting setup. Safe to remove.
