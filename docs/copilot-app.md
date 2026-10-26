# Working in the GitHub Copilot app

How this project is worked on from the GitHub Copilot desktop app. **Read this
at the start of every conversation held in the app**, alongside `AGENTS.md`.

## Orchestrator + Builder

Work is split across two sessions to save tokens:

- **Orchestrator** - the main session, on the strongest model. Talks to the
  owner, reads the docs, plans, and writes each task for the Builder.
- **Builder** - a child session (`create_session`, nested under the
  orchestrator) on a cheaper model (Claude Sonnet). It **only writes code**:
  one scoped task at a time, then a brief report of what changed. It never
  starts `vercel dev` for the owner's preview, and never commits unless told to.
  Before reporting a UI task done it **reviews its own work** (below).

**Builder self-review before reporting done (standing step).** For any UI task
the Builder loads the affected page(s) itself, in a headless browser against
its own server on a spare port (never the owner's preview tab, never the
owner's `vercel dev`), and looks at them at the sizes they'll be used at
(desktop and phone width). It checks for duplicated or overlapping controls
(including the browser's own chrome doubling ours: native password-reveal,
autofill icons, search clear buttons), misalignment, clipped text, wrong
colours, and every state that applies (hover, focus, disabled, loading, error),
and compares against the spec and the relevant HIG page
([design.md](design.md)). It fixes what it finds, then reports - saying what it
checked and what it could not. This is the Builder's own quality gate before
handing over; it does not replace the layers below.

Checking happens in two layers:

1. **The owner checks first**, in the shared preview (the app's browser canvas
   at `localhost:3000`). That's deliberate: the orchestrator sees the same page,
   so the owner can point at something on it.
2. **The orchestrator checks only after a clear instruction from the owner** -
   reviewing a diff, testing in the preview, or doing a specific task itself.
   The Builder finishing is not that instruction. When it finishes, report what
   changed and stop: no screenshots, no clicking through the preview, no
   reading the diff. This has been broken before and the owner had to repeat it.

Why this shape: Anthropic's orchestrator-worker research (strong lead, cheaper
workers) found it beats a single strong agent, but multi-agent setups burn
tokens fast and coding parallelises poorly. The saving only materialises when
each handoff is **small and fully specified**. A vague task gets redone and
costs more than doing it directly.

Practical rules that came out of the first session:

- Every task message is standalone: quote the owner's words verbatim, then the
  decided design and what "done" looks like. The Builder can't see this
  conversation.
- The orchestrator does work itself only when the owner says so.
- When the owner changes direction, tell the Builder to revert the abandoned
  work first, so nothing half-built is left behind.
- When reporting back, say plainly that nothing has been tested yet, so the
  owner knows to check the preview.

## Local preview

- `vercel dev --listen 3000` runs in a visible terminal canvas, **from the
  Builder's worktree**, so the Builder's edits appear in the preview without
  a restart. Only one instance, ever (see AGENTS.md).
- The preview is the app's integrated browser canvas at `localhost:3000/lab/` (the lab; `/` is the new blank app). It
  caches aggressively: navigate with a changing query (`?v=2`, `?v=3`, …) to
  be sure you're seeing the latest files.
- Both pages load `public/js/dev-reload.js`: on localhost/127.0.0.1 only, it polls the page and its own-origin CSS/JS about once a second and reloads when one changes, so no manual refresh after a save. It does nothing on any other host.
- A fresh worktree has no `.env.local` and isn't linked to Vercel. Setup, in
  that worktree: `vercel login` (once per machine, the owner approves in a
  browser), `vercel link --yes --project my-play-db --scope xoura-personal-projects`,
  `vercel env pull .env.local --yes`, `npm ci`. `.env.local` and `.vercel/` are
  git-ignored.

## Signing in to the preview

Use **email + password** in the preview. The owner doesn't want to type Google
credentials into the app's browser. Attempts to route Google sign-in through
the default browser or a popup were tried and dropped - a session lives in the
browser it was created in, so it can't be carried across. See
[auth.md](auth.md#gate-1---who-can-sign-in).

## Supabase MCP

Configured in `~/.copilot/mcp-config.json` (outside the repo; the app reads
it - there is no `copilot` command on this machine). The owner authorises it
once through the app. **Its tools only appear in sessions started after it was
added.** It can query and change the database but **cannot change Auth
settings** (providers, sign-ups) - those are dashboard-only:
`https://supabase.com/dashboard/project/bcqodvutikcetnxtzigr/auth/providers`.
Look up dashboard paths with its `search_docs` tool before sending the owner
there.

## Sosumi MCP (Apple HIG)

Configured in the same `~/.copilot/mcp-config.json`, pointing at
`https://sosumi.ai/mcp` (no sign-in). It returns Apple's design and developer
docs as Markdown, because Apple's own pages are JavaScript-only and unreadable
to agents. Tools: `searchAppleDocumentation`, `fetchAppleDocumentation`
(e.g. path `/design/human-interface-guidelines/color`),
`fetchAppleVideoTranscript`. Like Supabase, **its tools only appear in sessions
started after it was added.** Without the MCP, swap `developer.apple.com` for
`sosumi.ai` in any Apple URL and fetch it. Which pages to read for what:
[design.md](design.md).
