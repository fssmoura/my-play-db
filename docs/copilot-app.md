# Working in the GitHub Copilot app

How this project is worked on from the GitHub Copilot desktop app. **Read this
at the start of every conversation held in the app**, alongside `AGENTS.md`.

## Orchestrator + Builder

Work is split across two sessions to save tokens:

- **Orchestrator** - the main session, on the strongest model. Talks to the
  owner, reads the docs, plans, and writes each task for the Builder.
- **Builder** - a child session (`create_session`, nested under the
  orchestrator) on a cheaper model (Claude Sonnet). It **only writes code**:
  one scoped task at a time, then a brief report of what changed. No testing,
  no screenshots, no reviewing. It never starts `vercel dev`, and never
  commits unless told to.

Checking happens in two layers:

1. **The owner checks first**, in the shared preview (the app's browser canvas
   at `localhost:3000`). That's deliberate: the orchestrator sees the same page,
   so the owner can point at something on it.
2. **The orchestrator checks only when asked** - reviewing a diff, testing in
   the preview, or doing a specific task itself. Don't review or test by
   default; that's the token cost this setup exists to avoid.

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
- The preview is the app's integrated browser canvas at `localhost:3000`. It
  caches aggressively: navigate with a changing query (`?v=2`, `?v=3`, …) to
  be sure you're seeing the latest files.
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
