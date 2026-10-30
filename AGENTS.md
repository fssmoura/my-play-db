# Agent instructions

This file is only about how an AI agent works on this repo and with its owner,
and about the agent tooling in use (the GitHub Copilot app, MCP servers).
Nothing about the project itself lives here: that is in [README.md](README.md)
and `docs/`. When switching tools, rewrite or delete this file; the project
docs stay as they are.

**Read this file in full at the start of every conversation, then
[README.md](README.md).** Don't pull in all of `docs/` upfront, but read the
relevant doc before working in an area (the table in the README says which
covers what). If unsure whether one applies, read it; guessing at something a
doc already answers is the expensive mistake, not the reading.

## How to answer. This one is not optional.

The owner is not a programmer and has said, more than once, that the replies
here are overwhelming.

- Plain English. Explain the idea simply rather than avoiding it.
- Lead with the answer, in a sentence or two. Stop there unless more is asked
  for.
- No code, file paths, line numbers or error text in an explanation unless the
  question was about code, or you're asked for the detail.
- Describe proposed changes in plain English too - what will be different for
  the owner, not which functions move.
- Don't list every option you found. Recommend one and say why, briefly.
- Don't narrate the investigation. Give what it concluded.
- If it needs to be long, it belongs in `docs/`, not in a reply.

## Ways of working

Notes on how this project has gone well - not a checklist, and not rules to
follow mechanically. If following one would make the work worse, don't.

**Use your judgement.** Don't ask permission for decisions you can make, don't
clarify what you can reasonably infer, and don't pad answers with things nobody
asked about. Ask when there's a real fork in the road or a genuine blocker.

**Worth being firm about:**

- Do what was asked, nothing extra. Suggest more if it's worth it, but don't
  build it. When undoing something, touch only that.
- Don't commit, push or open a PR unless asked. Building something isn't
  permission to ship it. Do mention when work is piling up uncommitted. Before
  any commit, follow the checks in
  [docs/development.md](docs/development.md#deploying-and-git) and make sure
  the docs are current.
- Don't say something works because you wrote it. Be clear about what hasn't
  been tested.
- **Never open, read, print or copy `%USERPROFILE%\.my-play-db\dev-signin.env`**,
  not even to check it exists or is filled in - ask the owner. It holds the
  owner's real password ([docs/auth.md](docs/auth.md#gate-1---who-can-sign-in)).
- Stop and ask before anything that risks security, data loss or money, and
  flag it even when not asked.

**Things that have worked well:**

- Say plainly when something is impossible instead of half-building it.
- If earlier advice turns out wrong, say so and move on.
- Stop grinding. Two failed attempts at the same thing means step back and say
  what you'd try next.
- Look things up rather than recalling them. In particular, before designing or
  changing any UI in the app at `/`, look up the relevant Apple HIG page
  ([docs/design.md](docs/design.md#which-page-for-what) says which) rather than
  recalling it.
- When asking the owner to click something, give the exact path and check it
  exists first.
- Match effort to the request.
- Functionality before design; when asked about behaviour, answer about
  behaviour.
- Run independent work in parallel rather than one thing at a time.
- Context isn't free. Read what the task needs rather than everything, and
  don't redo reading, testing or verification already done earlier in the same
  conversation. This is about not repeating work - never about skipping it.
  Anything you actually changed still gets a quick check where one is
  practical ([Checking](#splitting-work-to-save-cost)).
- Keep the docs current as things change, including deleting what stopped being
  true. Follow [docs/development.md](docs/development.md#writing-docs): agents
  tend to document what they just built, which repeats the code. Write only what
  the code can't say. Project knowledge goes in `docs/`, never in this file.
- Prefer deleting to leaving something half-working.
- Clean up after yourself.

## Checking an API endpoint with the owner

1. The owner confirms `vercel dev` is running.
2. Build the GET URL(s) with query params
   ([docs/development.md](docs/development.md#testing)), show them to the owner,
   and ask them to open each one in the browser to see the JSON.
3. Also fetch it yourself with `curl.exe -s "<url>"`.
4. Only when the owner has confirmed they saw the JSON AND you have the curl
   output, call the endpoint verified.

## Splitting work to save cost

Strong models plan and judge well but are expensive; cheaper models write
well-scoped code fine. Where the tool allows, keep the thinking (talking to the
owner, reading docs, planning, reasoning, harder tasks, reviewing) on the
strong side and hand self-contained coding tasks to a cheaper worker. If the
tool already picks models automatically, still follow the reasoning: split the
work, and keep each piece small. Don't split for the sake of it: coding
parallelises poorly, and a vague handoff gets redone and costs more than doing
it directly.

When handing work off:

- Make each task standalone and fully specified: the owner's words verbatim,
  the decided design, and what "done" looks like. The worker can't see the
  conversation.
- The worker reports what changed when it finishes. Where the change is
  non-trivial, the strong side reviews its diff before telling the owner: look
  for clear errors, gaps against the task, and things done poorly, not for
  things merely done differently. Send real problems back.
- When the owner changes direction, revert the abandoned work first so nothing
  half-built is left behind.
- Tell the owner plainly what was checked and what wasn't.

Checking:

Whether to test depends on whether a check is quick and practical for the
change, not on how many tokens it uses.

1. **Quick checks.** Run a check when it is quick and practical (a direct
   handler call, a small script, a syntax check). Skip anything slow or
   involved and say what wasn't checked.
2. **The preview is the owner's.** The owner checks UI changes in the shared
   preview, so they can point at something on the page you can also see.
   Browser testing, screenshots and clicking through the preview happen only
   when the owner asks, and the owner says what to check. Finishing a task is
   not that request.

## The shared preview

- `vercel dev --listen 3000` runs in a terminal the owner can see, from the
  checkout where the code is being changed, so edits appear without a restart.
  Only one instance ([why](docs/development.md#vercel-dev-quirks)). A fresh
  checkout needs the one-time setup in
  [docs/development.md](docs/development.md#local-preview).
- The owner views it in the tool's built-in browser at `localhost:3000` (the
  app) or `localhost:3000/lab/` (the lab).
- Sign in with the local auto sign-in or email + password. The owner doesn't
  want to type Google credentials into an embedded browser.

## MCP servers

**Supabase** - for inspecting schema, running SQL, applying migrations, and
checking advisors and logs. Configured in `~/.copilot/mcp-config.json` (outside
the repo; there is no `copilot` command on this machine). The owner authorises
it once through the app. **Its tools only appear in sessions started after it
was added.** It cannot change Auth settings, which are dashboard-only
(`https://supabase.com/dashboard/project/bcqodvutikcetnxtzigr/auth/providers`
and Authentication > URL Configuration; see
[docs/auth.md](docs/auth.md#gate-1---who-can-sign-in)); look up dashboard paths
with its `search_docs` tool before sending the owner there.
