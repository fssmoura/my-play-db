# Development

How to run, test and ship the project.

## Local preview

`vercel dev` is the only way to run the API functions locally. VS Code Live
Server (or any static server) will not work.

**One-time setup per checkout** (a fresh clone or worktree has no
`.env.local` and isn't linked to Vercel):

```
vercel login          # once per machine; approve in the browser
vercel link --yes --project my-play-db
vercel env pull .env.local --yes
npm ci
```

If `vercel link` can't find the project, run it without `--yes` and pick the
Vercel team (scope) that owns `my-play-db`.

`.env.local` and `.vercel/` are git-ignored. The env vars each handler needs
are listed in [api.md](api.md) and [auth.md](auth.md).

**Run it:** `vercel dev --listen 3000`, then open:

- `http://localhost:3000/` - the app
- `http://localhost:3000/lab/` - the lab

**Signing in locally:** the preview can sign itself in from a file outside the
repo. See [local auto sign-in](auth.md#gate-1---who-can-sign-in).

**Seeing the latest files:**

- Both `index.html` files load `public/js/dev-reload.js`. On `localhost` /
  `127.0.0.1` only, it checks the page, its stylesheets and the scripts the
  page loads directly about once a second, and reloads when one changes. It
  does nothing on any other host. Modules imported by other scripts (most of
  `public/js/`) are not watched: after editing one, reload by hand.
- Embedded browsers can cache aggressively. Adding a changing query
  (`?v=2`, `?v=3`, ...) guarantees fresh files.

## `vercel dev` quirks

- **Run only one instance per folder.** Two in the same folder corrupt each
  other's build cache and produce phantom 404s.
- It reads env vars once at startup. Restart it after changing them.
- It builds each function lazily on its first request, so a first-hit 404 is
  usually just the build.
- After a real deploy, endpoints can 404 for a minute or two while Vercel's
  edge propagates. Wait before declaring it broken.

## Testing

There is no test framework.

- **Handlers directly:** import a handler and call it with a mocked `req`/`res`.
  Faster and far more reliable than going through `vercel dev`.
- **Endpoints in the browser:** every handler also accepts GET with query
  params, and the sign-in token can be passed as `access_token` in the query
  ([auth.md](auth.md#gate-2---who-can-call-api)), so an action can be checked by
  opening a URL like
  `http://localhost:3000/api/igdb?action=search&options={"query":"halo"}` or
  with `curl.exe -s "<url>"`. Query values are JSON-parsed per key
  ([api.md](api.md)).
- **The lab** has an API console that can run any handler action
  ([lab.md](lab.md)).
- When a test fails, first check whether the test is wrong.

## Writing docs

Docs add what the code can't say. If reading the code answers it, don't write
it down - it only repeats the code and goes stale when the code changes.

Worth documenting:

- **Why** something is built the way it is, and what was tried and rejected.
- **Traps:** behaviour that looks wrong but is deliberate, or looks safe to
  change but breaks something.
- **Facts from outside the code:** how a third-party API really behaves,
  measurements, licences, dashboard-only settings.
- **Decisions and rules** the code must keep following (design rules, matching
  rules, data rules).

Not worth documenting: what each function or file does, step-by-step
walkthroughs of the code, styling values, or a changelog of what was built.

Each fact lives in one doc. Anywhere else, link to it rather than repeating it.
Delete what stops being true.

## Formatting

`npx prettier --write <file>`.

## Supabase

Schema changes are applied as Supabase migrations (stored in Supabase, not in
this repo). Auth settings are dashboard-only - see
[auth.md](auth.md#gate-1---who-can-sign-in) for which settings matter and where
they live.

## Deploying and Git

- `main` is production and auto-deploys to Vercel. Active work goes on
  `feat/*` branches.
- Rebase feature branches; no merge commits.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:` -
  lowercase after the prefix, present tense imperative.
- Before committing, check the diff for keys and tokens. The repository is
  public.
