# Auth and the credential vault

How the app proves it's the owner, and how platform tokens are stored and kept
alive. Read this before touching `api/_auth.js`, `public/js/session.js`,
`public/lab/js/vault.js`, `public/lab/js/refresh.js`, `public/lab/js/connect.js` or
`api/cron-refresh.js`.

The app is a private, single-owner tool deployed publicly. Two independent gates enforce that.

## Gate 1 - who can sign in

Supabase Auth with two methods: **Google** and **email + password**. The owner's password is already set; the app has no sign-up, forgot-password or set-password UI - to change it, use the Supabase dashboard. In Supabase, "Allow new users to sign up" is OFF and the Email provider is ON, on top of the trigger below. Sign-in is locked by a `before insert` trigger on `auth.users` (`enforce_owner_allowlist_on_signup`, which runs the `security definer` function `public.enforce_owner_allowlist()`):

- If the email is in `public.owner_allowlist`, allow.
- Else if `auth.users` is empty, allow **and record that email as the owner** (first signup claims the app).
- Else `raise exception 'signup is closed'`.

The owner's email is the one recorded in `owner_allowlist`. To authorise a second identity, insert it into `owner_allowlist` via SQL - there is no UI for this, and `owner_allowlist` has RLS on with **no policies**, so it is unreachable from any client key.

**Sign-in flow.** There is **one sign-in, owned by the app at `/`** (`public/index.html`, `public/js/sign-in.js`, styled by `public/css/sign-in.css`). The lab at `/lab/` has no sign-in of its own: with no session it redirects to `/?next=<path+query>`, and once signed in `/` sends the user back to `next` (accepted only if it starts with `/` and not `//`). With no `next`, a signed-in user sees the app. Google sign-in returns to `<origin>/` (carrying `?next=` through), set as `redirectTo` in `session.js`. Supabase Auth's redirect allow-list (Authentication > URL Configuration, dashboard-only) **must include the root URLs** (e.g. `http://localhost:3000/` and `https://my-play-db.vercel.app/`, wildcard if the dashboard needs one to permit the `?next=` query), or Google sign-in falls back to the Site URL. Sign out from the lab goes to `/`.

**Local auto sign-in (local preview only).** On `localhost` / `127.0.0.1`, when there is no session, `sign-in.js` calls `POST /api/dev-signin` once. That handler reads `%USERPROFILE%\.my-play-db\dev-signin.env` (`DEV_SIGNIN_EMAIL=`, `DEV_SIGNIN_PASSWORD=`; outside every checkout so every worktree's preview shares it and Git can never pick it up; deliberately not `.env.local`, which `vercel env pull` rewrites; never added to Vercel). **The file holds the owner's real password; only the owner fills it in.** The handler signs in to Supabase server-side and returns only the two tokens, and the page adopts them with `setSession`. It returns **404** unless `VERCEL_ENV` is unset or `development` (what `vercel dev` uses), the Host is `localhost:<port>` or `127.0.0.1:<port>`, any `Origin` is the same origin, the method is POST and the file holds both values - so on production it simply doesn't exist. Any failure falls back silently to the normal sign-in screen, with no retry; an explicit sign-out sets a `sessionStorage` flag that stops it for that tab. **To turn it off, delete the file** (or empty its values).

**Why email + password locally.** Without the auto sign-in, sign in to the local preview with email + password. Routing Google sign-in through the default browser or a popup was tried and dropped: a session lives in the browser it was created in, so it can't be carried across to an embedded preview browser.

## Gate 2 - who can call /api/\*

`api/_auth.js` exports `requireUser(req, res)`. Every data handler calls it immediately after the CORS preflight and before parsing the body. The two exceptions are `cron-refresh.js` (checks `CRON_SECRET` instead, see below) and `dev-signin.js` (local only, see Gate 1):

```js
setCorsHeaders(req, res);
if (handlePreflight(req, res)) return;
const user = await requireUser(req, res);
if (!user) return;
```

It reads the bearer token from `Authorization`, falling back to `access_token` in the query/body (so endpoints can be tested by pasting a URL into a browser). It verifies against `${SUPABASE_URL}/auth/v1/user`, caches valid tokens in memory for 60s, and returns **403** if `OWNER_USER_ID` is set and does not match.

Without this, anyone could hit the deployed endpoints and burn `STEAM_API_KEY` / `TWITCH_CLIENT_SECRET` / `STEAMGRIDDB_API_KEY` quota.

Its env vars, and the CORS rule that keeps the `Authorization` header allowed, are in [api.md](api.md#rules-every-handler-shares).

## `platform_credentials` table

Cross-device token store, one row per `(user_id, platform)` (a `unique` constraint). RLS scopes every operation to `auth.uid()`; `anon` has no grants at all.

**This table is about ACCESS only.** Its single job is to guarantee that, for
platforms that allow it, tokens stay valid so an integration never silently
breaks. It is not a profile store.

| Column               | Notes                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| `id`                 | bigint PK                                                               |
| `user_id`            | uuid, defaults to `auth.uid()`, FK `auth.users`                         |
| `platform`           | check: `psn` / `steam` / `epic` / `xbox` / `ea`                         |
| `credentials`        | jsonb - tokens needed to call the handler                               |
| `identity`           | jsonb - **connect-time snapshot only** (see below)                      |
| `expires_at`         | timestamptz, normalized by the client                                   |
| `refresh_expires_at` | timestamptz, null when the platform offers no refresh                   |
| `connected_at`       | timestamptz, defaults to `now()`                                        |
| `updated_at`         | timestamptz, set by the `platform_credentials_touch_updated_at` trigger |
| `last_refresh_at`    | timestamptz, when a refresh last succeeded                              |
| `last_refresh_error` | text, message from the last failed refresh, cleared on success          |

**`identity` is never rewritten by a refresh.** It exists purely so one
account's credential can be told apart from another's (`{ name, accountId }`),
and it is captured once at connect time. Refresh paths never write it: in the
browser, `refresh.js` (via `vault.js`) upserts without it, which
`ON CONFLICT DO UPDATE` then leaves untouched; on the server, `cron-refresh.js`
PATCHes only the access columns, by row `id`.

Do not "helpfully" refresh identity here. Display data (usernames, avatars,
trophy summaries, gamerscore) belongs in a **future `platform_profiles` table**
fed by the platforms' own profile endpoints on its own schedule. Mixing the two
is what previously made names update on Epic and Xbox but never on Steam or EA.

`last_refresh_error` makes a dying integration visible in the UI instead of only
surfacing when the refresh token finally lapses.

Table-level grants are required for this table like any other - see [database.md](database.md).

## Expiry normalization

Every platform reports expiry differently. `public/lab/js/platforms.js` normalizes all of them into `expires_at`:

| Platform | Raw response                        | Normalized                                                                                         |
| -------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| PSN      | `accessTokenExpiry` (ISO)           | used directly                                                                                      |
| Epic     | `expires_at` / `refresh_expires_at` | used directly                                                                                      |
| Xbox     | `expiresIn` seconds only            | `now + expiresIn`, else `now + 1h`                                                                 |
| EA       | `expires_in` seconds (handler)      | handler sends `now + expires_in` (fallback 4h); refresh expiry from the `remid` cookie's `expires` |
| Steam    | n/a                                 | `null` + `neverExpires: true`                                                                      |

Two platform quirks the client compensates for, both easy to regress:

- **Xbox refresh rotates `xstsToken` AND `userHash`**, not just the token. The whole tuple is re-persisted on every refresh or subsequent calls 401.
- **Epic burns a token refresh** resolving the account id if `epicAccountId` is omitted, so `callCredentials` always sends it.

`public/lab/js/api.js` also absorbs the one handler inconsistency (psn.js reads credentials from the top level of the body; see [api.md](api.md)).

## Connect flows (how a credential is captured)

Two modes, forced by the browser's same-origin policy - a popup on another
domain cannot have its URL or body read by us.

| Platform | Mode        | Why                                                                                                                                                     |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam    | `openid`    | Steam OpenID 2.0 accepts an arbitrary `return_to`, so the popup redirects back to **our** origin. Fully automatic.                                      |
| PSN      | `clipboard` | `ssocookie` renders JSON on Sony's domain. Unreadable cross-origin.                                                                                     |
| Epic     | `clipboard` | `id/api/redirect` renders JSON on Epic's domain.                                                                                                        |
| EA       | `clipboard` | Paste only, no popup: the user pastes the `accounts.ea.com` cookies (Copy as cURL). The `nucleus:rest` implicit grant is used server-side by `refresh`. |
| Xbox     | `clipboard` | Redirect URI is `login.live.com/oauth20_desktop.srf`, which we don't own.                                                                               |

**Steam (`openid`)**: `connect.js` builds the OpenID URL with
`return_to = <origin>/lab/steam-callback.html`. That bare page postMessages the
`openid.*` params to `window.opener` and closes. The parent then calls
`steam.openid_verify`, which does the mandatory `check_authentication` handshake
with Steam server-side before trusting the SteamID64 - never trust the callback
params directly.

**Everything else (`clipboard`)**: the popup opens PSN's sign-in page
(`loginUrl`, with a separate "get credential" button for the credential URL) or,
for Epic and Xbox, the credential URL itself (already authenticated, so the JSON
renders immediately); EA opens nothing (below). A modal appears, and
`awaitClipboardCredential` reads `navigator.clipboard.readText()` every second
and on window focus, but only while the document has focus. The moment the clipboard parses into a valid credential it connects and
closes the popup. Clipboard permission can be denied, so the modal **always**
keeps a manual paste field - do not remove it.

`public/lab/js/credentials.js` holds the pure extractors (no imports, unit-testable).
Most accept JSON, a full redirect URL, or the bare value; EA takes a cURL blob,
a cookie header or `name=value` lines and needs `sid`; Steam takes only a bare
17-digit ID. Each returns `null`
when the text isn't a credential - that `null` is what makes clipboard polling
keep waiting instead of connecting with garbage.

**To make Xbox fully automatic**, register your own Azure app with a callback
page on our origin (for example `<origin>/lab/xbox-callback.html`, which does
not exist yet) as a redirect URI and swap `XBOX_CLIENT_ID` in `api/xbox.js`.
PSN, Epic and EA cannot be automated from a browser at all.

## Auto-refresh

`public/lab/js/refresh.js` keeps tokens alive so you don't reconnect constantly. A
platform is refreshed when under **10 minutes** remain, checked when the lab's
Connections view mounts (on lab boot, which is also where the timer and focus
checks start), every 4 minutes, on tab focus, and lazily before any API console
call.

| Platform | Auto-refresh | Reconnect needed when                        |
| -------- | ------------ | -------------------------------------------- |
| PSN      | yes          | refresh token expires (~10 days idle)        |
| Epic     | yes          | refresh token expires (~1 year)              |
| Xbox     | yes          | MSA refresh token expires                    |
| Steam    | n/a          | never                                        |
| EA       | yes          | the stored `accounts.ea.com` cookie set dies |

A failed refresh is memoized in a `failed` set so a dead refresh token isn't
retried every tick; `clearFailure(id)` is called after a manual reconnect.

`startAutoRefresh` reports **failures as well as successes** to its caller. That
is not cosmetic: reporting only successes meant a platform whose refresh had
just started failing kept a stale green status on screen until the page was
reloaded by hand - the one moment the screen most needed to change was the one
it stayed still for.

This only runs while a tab is open. A server-side sync job needs its own refresh pass.

## Keeping the connections screen honest

The statuses shown on the connections tab are derived from stored timestamps, so
they go stale just by sitting there. `views/connections.js` keeps them current
with two deliberately cheap mechanisms:

- **a 30-second repaint** of the dots and the "40d left" text, computed from the
  records already in memory - no network at all;
- **a vault re-read on tab focus**, so a change made overnight by the cron, or on
  another device, appears when you come back.

Both are skipped while the JSON editor is open or a connect dialog is up, since
a repaint would discard what you were typing. The repaint updates the dot and
status text **in place** rather than calling `render()`, for the same reason.

Neither mechanism calls a platform API, and the focus re-read is a single
Supabase select - this is about not lying on screen, not about polling.

**Deliberately not built: Supabase realtime on `platform_credentials`.** It
would make the tab genuinely live, but for a single-user app the focus re-read
covers the same ground for a fraction of the machinery.

**Also not detected: a revoked token.** Staleness here is measured purely from
expiry timestamps. A token killed at the platform's end - password change, app
revoked - still looks healthy until something actually tries to use it. Catching
that needs a real per-platform health check, which does not exist.

**EA renews from session cookies, not a refresh token.** This is the one place
where "does the record have a `refreshToken`?" is the wrong question, so both
`public/lab/js/platforms.js` (`hasRefreshMaterial`) and
`api/_platform-refresh.js` (`hasRefreshMaterial`) decide it per platform. The
full story is below.

**EA auth URL MUST include `prompt=none`.** `ORIGIN_JS_SDK` is a JS-SDK client
that is only permitted to mint a token from an _existing_ ea.com session.
Driving an interactive login through it fails with "Your request cannot be
completed. Service limitations apply." `prompt=none` lives in the server-side
`EA_AUTH_URL` (in both `ea.js` and `_platform-refresh.js`), and the server
replays the stored session cookies against it, which returns the token
silently. Removing `prompt=none` breaks it. Connecting is: paste the cookies,
then `ea.refresh` mints a token, then `ea.auth` reads the identity.

## EA: renewing from session cookies

EA issues no refresh token, and the access token lasts **4 hours** (`expires_in`
is 14399). What it does issue, to a signed-in browser, is a set of cookies on
`accounts.ea.com`. Trading those for a fresh token is the same request the EA
website makes to keep itself signed in.

**The minimum EA accepts is `sid` + `_nx_mpcid` together.** Measured by
replaying a captured browser request and removing one cookie at a time:

| Cookies sent                  | Result           |
| ----------------------------- | ---------------- |
| `sid` + `_nx_mpcid`           | works            |
| `remid` + `sid` + `_nx_mpcid` | works            |
| `remid` + `_nx_mpcid`         | `login_required` |
| `sid` alone                   | `login_required` |
| `remid` alone                 | `login_required` |
| `_nx_mpcid` alone             | `login_required` |

`_nx_mpcid` is the surprise, and missing it is what made the first attempt at
this fail: everything looked right, and EA answered `login_required` anyway. The
remaining cookies EA sets (`ealocale`, `PIM-SESSION-ID`, the `notice_*` and
`cmapi_*` consent pairs) made no difference when removed.

`remid` is the long-lived "remember me" value and is expected to outlive `sid`,
but it is not sufficient on its own. EA may hand back a replacement `sid` - and
sometimes `remid` - in `set-cookie`, so **the whole set is stored and replayed
together, and anything returned overwrites what was sent**. Miss a rotation and
the chain is dead, and only a manual reconnect fixes it. Verified by renewing
three times in a row from nothing but the previously stored cookies.

`login_required` means the stored set is dead. It is translated into a plain
"reconnect EA" message rather than surfaced as a raw error code. In `ea.js`, a
set that is merely missing `sid` or `_nx_mpcid` says so specifically instead;
the cron's copy in `_platform-refresh.js` reports a generic "missing or
incomplete" error.

**Connecting EA needs the cookies copied out of the browser by hand.** There is
no EA endpoint that hands a long-lived credential to the user, and a page cannot
read another origin's cookies - that protection is doing its job. The connect
dialog asks for Chrome's **Copy as cURL** output and keeps only the three
cookies it needs; pasting that is one action instead of hunting three values.
Expect to redo it every few months.

**The connect dialog deliberately opens nothing.** Every other platform pops up
a login window, and EA originally did too - which broke it, because loading an
EA page makes EA re-issue the very cookies being copied. They were dead before
they could be pasted. `cookieHint` on the platform definition is what suppresses
the popup; do not "helpfully" add one back.

**Two dead ends, so nobody re-investigates them:**

- _EA Desktop's client_ (`JUNO_PC_CLIENT`, redirect
  `qrc:///html/login_successful.html`) supports `response_type=code`, but then
  demands a `pc_sign` machine signature produced by EA's own desktop software.
  Faking it means reverse-engineering that client.
- _The ea.com web client_ (`EADOTCOM-WEB-SERVER`) accepts the code flow with any
  `https://www.ea.com/*` redirect and needs no `pc_sign` - but exchanging the
  code at `/connect/token` requires a client secret only EA holds. Every
  `client_id` tested returns `invalid_client: unknown client` without it.

**Do not expose `refresh` in the API console.** Running it by hand spends the
rotating cookies outside the vault, so the replacements are discarded and the
stored chain is left dead. `public/lab/js/schemas.js` omits it deliberately.

## Scheduled refresh (the thing that survives the app being closed)

`refresh.js` only runs in an open tab, so it cannot stop a refresh token lapsing
while the app is unused. `api/cron-refresh.js` closes that gap: a Vercel Cron
hits it daily at 03:00 UTC, it reads `platform_credentials` with the **service
role key** (bypassing RLS), and renews every platform that has refresh
material: PSN / Epic / Xbox refresh tokens, and EA's stored cookie set (whatever
cookies EA hands back are persisted, as above). Steam, and any record without
refresh material, lands in `skipped`. The same run also prunes the games cache
([database.md](database.md)).

It authenticates via `Authorization: Bearer ${CRON_SECRET}` - **not** the owner
JWT gate, since the caller is a machine. A bad secret gets 401, and missing
config or a failed first read of `platform_credentials` gets 500. Once the
refresh loop runs it responds 200 (with per-row detail in the body) so a single
platform failing doesn't mark the cron failed; a prune failure lands in
`errors` too. It never logs token values.

Refresh logic lives in `api/_platform-refresh.js`, duplicated from the handlers
because they only export a request handler. **If you change the token mapping in
`psn.js` / `epic.js` / `xbox.js` / `ea.js`, change it here too.**

Vercel Hobby only allows daily cron granularity. That is sufficient: the job
exists to roll the long-lived _refresh_ token (PSN ~10 days), not the short
access token.

Extra env: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never shipped
to the browser).

## Mobile

Popups are unreliable on mobile, so for Steam (`connectMode: openid`, the only
platform this applies to) `connect.js` switches to a **full-page redirect**,
returning to `/lab/?mpdb_state=...`, when `(pointer: coarse)` or the viewport is
820px wide or narrower. Clipboard platforms still use a popup. iOS Safari's
transient-activation window is so short that any `await` between the tap and
`window.open()` breaks it, and MSAL/Auth0/Supabase all recommend redirects for
mobile web. A same-tab `location.href` assignment cannot be popup-blocked.

The redirect stores `{ platform, state, createdAt }` in **both** sessionStorage
and localStorage (iOS can evict a backgrounded tab), validates the `state` nonce
and a 10-minute TTL on return, and cleans the URL with `replaceState` so the
credential never enters history. Resume runs inside `connections.mount()`, i.e.
**after** the Supabase session is restored - otherwise the verify call 401s.

**Clipboard auto-capture does not work on iOS Safari or Firefox** and never
will: a `focus` event isn't transient user activation, cross-origin clipboard
content always triggers the paste prompt, switching tabs rejects the pending
promise, and neither browser will support the `clipboard-read` permission. The
manual paste field is the _only_ path there - it is not a nicety.
