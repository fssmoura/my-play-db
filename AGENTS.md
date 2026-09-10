# my-play-db

Personal game library - pulls PSN (and eventually other platforms) data into one place.

This is not a public service. It's a private data pipe. The API layer has zero business logic, no database, no merging. It maps 1:1 to what the source provides so a sync script or frontend can decide what to store and how.

**At the start of every conversation, regardless of the prompt, read this file in full plus every doc under `docs/` before doing any work.** Don't skip docs because the task looks small or unrelated.

## Ways of working

Notes on how this project has gone well - not a checklist, and not rules to
follow mechanically. If following one would make the work worse, don't.

**Use your judgement.** Don't ask permission for decisions you can make, don't
clarify what you can reasonably infer, and don't pad answers with things nobody
asked about. Ask when there's a real fork in the road or a genuine blocker.

**Worth being firm about:**

- Don't commit, push or open a PR unless asked. Building something isn't
  permission to ship it. Do mention when work is piling up uncommitted.
- Don't say something works because you wrote it. Test it, and be clear about
  what you couldn't test.
- Check the diff for keys and tokens before committing.
- Interrupt for anything risking security, data loss or money, even unasked.
  Where it's urgent, act first and explain after.

**Things that have worked well:**

- Plain English; the owner isn't a programmer. Explain the idea simply rather
  than avoiding it.
- Lead with the answer.
- Say plainly when something is impossible instead of half-building it.
- If earlier advice turns out wrong, say so and move on.
- Stop grinding. Two failed attempts at the same thing means step back and say
  what you'd try next.
- Look things up rather than recalling them.
- When asking the owner to click something, give the exact path and check it
  exists first.
- Match effort to the request.
- Functionality before design; when asked about behaviour, answer about
  behaviour.
- Simple and practical now, modular enough to be redesigned later. The look will
  be rebuilt by hand from a real design, so keep behaviour independent of
  presentation - a different UI, on different pages, should be able to reuse the
  logic without rewriting it.
- Functional still has to be usable. Wireframe means unstyled, not awkward.
- Run independent work in parallel rather than one thing at a time.
- Keep the docs current as things change, including deleting what stopped being
  true.
- Prefer deleting to leaving something half-working.
- Clean up after yourself.

## Dev

- **`vercel dev`** - local server at localhost:3000 (only way to test API functions). Do NOT use VS Code Live Server.
- **`npx prettier --write <file>`** - formatting. No linter, no test framework, no build step configured.

Testing notes:

- Handlers can be invoked directly with a mocked `req`/`res` instead of going
  through `vercel dev` - faster and far more reliable.
- **Two `vercel dev` instances in the same folder corrupt each other's build
  cache** and produce phantom 404s. Run one.
- `vercel dev` reads env vars once at startup, and lazily builds each function
  on its first request. Restart it after changing env vars; a first-hit 404 is
  usually just the build.
- After a deploy, endpoints can 404 for a minute or two while Vercel's edge
  propagates. Wait before declaring it broken.
- When a test fails, first check whether the test is wrong.

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

## Gotchas

Short list of things that have already caused bugs here. Each is explained in
the linked doc - this list exists so they cannot be missed.

**API handlers**

- **`psn.js` reads credentials from the TOP LEVEL of the body. Every other
  handler expects them nested inside `options`.** `public/js/api.js` absorbs
  this; don't reintroduce it elsewhere.
- **`psn.js` handles the `auth` action before the generic authorization path.**
  Do not reorder.
- GET query params are `JSON.parse`d per key. An all-numeric string becomes a
  number.
- Per-action validation errors return **500**, not 400.
- `_cors.js` must keep allowing the `Authorization` request header, or every
  browser call fails preflight.

**Tokens**

- **Xbox refresh rotates `xstsToken` AND `userHash`**, not just the token.
  Re-persist the whole tuple or the next call 401s.
- **Epic burns a token refresh** resolving the account id when `epicAccountId`
  is omitted. Always send it.
- **EA needs `prompt=none` AND a two-step login.** `ORIGIN_JS_SDK` can only
  mint a token from an existing ea.com session; an interactive login through it
  fails with "Service limitations apply".
- **`identity` is never rewritten by a refresh.** The credential vault is about
  access only; profile data belongs in a future `platform_profiles` table.
- `api/_platform-refresh.js` duplicates the token mapping from
  `psn.js`/`epic.js`/`xbox.js`. Change one, change the other.

**Database**

- **New tables need an explicit `grant ... to authenticated`.** This project has
  no default privileges, and Postgres checks privileges _before_ RLS policies,
  so policies alone produce `42501 permission denied`.

**Frontend**

- **No inline styles.** JavaScript writes class names only; all CSS lives in
  `public/css/app.css`.
- **`public/js/schemas.js` must be kept in step with the handlers.** A new
  action or option that isn't there is unreachable from the API console.

## Reference docs

`AGENTS.md` is loaded every conversation and stays short. Detail lives in
`docs/`. Read the relevant one _before_ changing that area.

| Doc                                            | Read it before                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [docs/api.md](docs/api.md)                     | changing a handler or adding an action                           |
| [docs/auth.md](docs/auth.md)                   | touching sign-in, the credential vault, connect flows or refresh |
| [docs/database.md](docs/database.md)           | adding a table or column, or writing a sync script               |
| [docs/frontend.md](docs/frontend.md)           | changing anything under `public/`                                |
| [docs/api-responses.md](docs/api-responses.md) | you need a real captured response or field observation           |

## Git

- `main` = production (auto-deploys to Vercel), `feat/*` = active dev
- Rebase feature branches (no merge commits)
- Conventional Commits: `feat:`, `chore:`, `refactor:`, etc. - lowercase after prefix, present tense imperative
