# my-play-db

A personal game library that pulls play data from PlayStation, Steam, Epic,
Xbox and EA into one place, enriched with IGDB game data, SteamGridDB art and
HowLongToBeat playtimes.

It is not a public service: one owner, private sign-in, deployed on Vercel.

## How it fits together

- **API layer (`api/`)** - thin Vercel serverless functions, one per source.
  They hold no business logic, no database and no merging: each action maps
  1:1 to what the source provides, so the frontend (or a future sync script)
  decides what to store and how. Every data call requires the owner's
  sign-in; the nightly job uses its own secret, and the local-only dev sign-in
  endpoint is the exception by design.
- **Database** - Supabase (Postgres + Auth). Stores platform tokens, a cache of
  IGDB game records and, later, the owner's library.
- **Two frontends**, sharing the same API, sign-in and database:
  - **The app at `/`** (`public/`) - the real app, built fresh: sign-in, search
    with filters, a results grid and a game page.
  - **The lab at `/lab/`** (`public/lab/`) - the older tabbed app, kept as a
    test bench for every feature. It is kept working but not redesigned, and
    app work must not change it.

```
Browser  -> POST /api/psn    -> psn-api  -> PlayStation Network
         -> POST /api/steam  -> fetch    -> Steam Web API
         -> POST /api/epic   -> https    -> Epic internal APIs
         -> POST /api/xbox   -> https    -> Xbox Live
         -> POST /api/ea     -> https    -> EA GraphQL + REST APIs
         -> POST /api/igdb   -> fetch    -> IGDB v4 (Twitch-backed)
         -> POST /api/sgdb   -> fetch    -> SteamGridDB v2 (community art)
         -> POST /api/hltb   -> fetch    -> HowLongToBeat (scraped, no API)
Browser  -> Supabase (sign-in, tokens, games cache)
Vercel Cron (daily) -> /api/cron-refresh -> keeps platform tokens alive, prunes the games cache
```

## Stack

- **Backend:** Node, CommonJS (`require`, no `"type": "module"`, because
  `psn-api` is CommonJS). One dependency, `psn-api`; everything else uses
  `fetch` or Node's `https`.
- **Frontend:** vanilla JavaScript ES modules in the browser. No framework,
  bundler, TypeScript or build step. Supabase's client loads from esm.sh.
- **Hosting:** Vercel (`vercel.json`: serves `public/`, the nightly cron, and
  `/img/*` image rewrites with long cache headers).
- **Tooling:** Prettier for formatting. No linter or test framework.

## Files

```
api/
  _cors.js              CORS allow-list + preflight
  _auth.js              owner sign-in gate used by every data handler
  _platform-refresh.js  server-side token refresh (PSN, Epic, Xbox, EA)
  cron-refresh.js       nightly Vercel Cron job
  dev-signin.js         local-only auto sign-in (404 everywhere else)
  psn.js steam.js epic.js xbox.js ea.js   platform handlers
  igdb.js sgdb.js hltb.js                 game data handlers
public/
  index.html            the app (sign-in screen, then the app)
  js/ css/              the app's code and styles
  vendor/liquidGL.js    liquid glass library (patched copy)
  lab/                  the lab, with its own js/ and css/
docs/                   the reference docs below
vercel.json             output folder, cron schedule, image rewrites + cache headers
```

## Docs

| Doc                                            | Covers                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [docs/development.md](docs/development.md)     | running the local preview, testing, deploying, Git conventions     |
| [docs/api.md](docs/api.md)                     | every handler and action, CORS, IGDB/SteamGridDB/HLTB rules        |
| [docs/api-responses.md](docs/api-responses.md) | real captured responses and field observations                     |
| [docs/auth.md](docs/auth.md)                   | sign-in, local auto sign-in, the token vault, connect and refresh  |
| [docs/database.md](docs/database.md)           | tables, the games cache, grants                                    |
| [docs/frontend.md](docs/frontend.md)           | the app at `/`: structure, search, game page, liquid glass         |
| [docs/lab.md](docs/lab.md)                     | the lab at `/lab/`                                                 |
| [docs/design.md](docs/design.md)               | design rules for the app (Apple's HIG, colours, glass, components) |

## Known traps

Things that have already caused bugs. Each is explained in the linked doc.

- `psn.js` reads credentials from the top level of the body; every other
  handler expects them inside `options`. ([api.md](docs/api.md))
- Xbox refresh rotates the token and `userHash`; EA renews from a rotating
  cookie set, not a refresh token, and its connect dialog must open no EA page.
  ([auth.md](docs/auth.md))
- `api/_platform-refresh.js` duplicates the handlers' token mapping. Change
  one, change the other.
  ([auth.md](docs/auth.md#scheduled-refresh-the-thing-that-survives-the-app-being-closed))
- New tables and functions need explicit grants, including for the cron's
  `service_role`. ([database.md](docs/database.md))
- `games` is a cache of IGDB records, not the owner's library, and prunes
  itself; the first image in `cover`/`logo`/`banner` is the chosen one.
  ([database.md](docs/database.md))
- IGDB's `updated_at`/`checksum` are not change signals.
  ([api.md](docs/api.md))
- HowLongToBeat has no API; the scraper will break, and its endpoint path must
  never be hardcoded. ([api.md](docs/api.md))
- SteamGridDB and HowLongToBeat matching may return nothing, and that is
  correct; a wrong match is worse than none. The SteamGridDB rules are copied
  into both the app and the lab; HowLongToBeat matching is lab-only so far.
  ([api.md](docs/api.md#matching-igdb-games-to-sgdb-entries))
- Every cover host needs CORS or a same-origin `/img` rewrite, or covers show
  grey under the glass. ([frontend.md](docs/frontend.md))
- `public/vendor/liquidGL.js` is a patched copy; never swap it for the npm or
  CDN version. ([frontend.md](docs/frontend.md))
- The lab uses no inline styles, and its API console schemas must be kept in
  step with the handlers. ([lab.md](docs/lab.md))
