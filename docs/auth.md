# App auth & credential vault

How the app proves it's the owner, and how platform tokens are stored and kept
alive. Read this before touching `api/_auth.js`, `public/js/session.js`,
`public/js/vault.js`, `public/js/refresh.js`, `public/js/connect.js` or
`api/cron-refresh.js`.

The app is a private, single-owner tool deployed publicly. Two independent gates enforce that.

### Gate 1 - who can sign in

Supabase Auth with the **Google provider only**. Sign-in is locked by a `before insert` trigger on `auth.users` (`public.enforce_owner_allowlist`):

- If the email is in `public.owner_allowlist`, allow.
- Else if `auth.users` is empty, allow **and record that email as the owner** (first signup claims the app).
- Else `raise exception 'signup is closed'`.

Owner is `fssmoura.fm@gmail.com`. To authorise a second identity, insert it into `owner_allowlist` via SQL - there is no UI for this, and `owner_allowlist` has RLS on with **no policies**, so it is unreachable from any client key.

### Gate 2 - who can call /api/\*

`api/_auth.js` exports `requireUser(req, res)`. Every handler calls it immediately after the CORS preflight and before parsing the body:

```js
setCorsHeaders(req, res);
if (handlePreflight(req, res)) return;
const user = await requireUser(req, res);
if (!user) return;
```

It reads the bearer token from `Authorization`, falling back to `access_token` in the query/body (so endpoints can be tested by pasting a URL into a browser). It verifies against `${SUPABASE_URL}/auth/v1/user`, caches valid tokens in memory for 60s, and returns **403** if `OWNER_USER_ID` is set and does not match.

Without this, anyone could hit the deployed endpoints and burn `STEAM_API_KEY` / `TWITCH_CLIENT_SECRET` / `STEAMGRIDDB_API_KEY` quota.

Required env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OWNER_USER_ID`. Note `_cors.js` allows the `Authorization` request header - do not remove it.

### `platform_credentials` table

Cross-device token store, one row per `(user_id, platform)`. RLS scopes every operation to `auth.uid()`; `anon` has no grants at all.

**This table is about ACCESS only.** Its single job is to guarantee that, for
platforms that allow it, tokens stay valid so an integration never silently
breaks. It is not a profile store.

| Column               | Notes                                                          |
| -------------------- | -------------------------------------------------------------- |
| `user_id`            | uuid, defaults to `auth.uid()`, FK `auth.users`                |
| `platform`           | check: `psn` / `steam` / `epic` / `xbox` / `ea`                |
| `credentials`        | jsonb - tokens needed to call the handler                      |
| `identity`           | jsonb - **connect-time snapshot only** (see below)             |
| `expires_at`         | timestamptz, normalized by the client                          |
| `refresh_expires_at` | timestamptz, null when the platform offers no refresh          |
| `last_refresh_at`    | timestamptz, when a refresh last succeeded                     |
| `last_refresh_error` | text, message from the last failed refresh, cleared on success |

**`identity` is never rewritten by a refresh.** It exists purely so one
account's credential can be told apart from another's (`{ name, accountId }`),
and it is captured once at connect time. Refresh paths - both `refresh.js` in
the browser and `cron-refresh.js` on the server - deliberately omit it from the
payload, which `ON CONFLICT DO UPDATE` then leaves untouched.

Do not "helpfully" refresh identity here. Display data (usernames, avatars,
trophy summaries, gamerscore) belongs in a **future `platform_profiles` table**
fed by the platforms' own profile endpoints on its own schedule. Mixing the two
is what previously made names update on Epic and Xbox but never on Steam or EA.

`last_refresh_error` makes a dying integration visible in the UI instead of only
surfacing when the refresh token finally lapses.

> **Table-level `GRANT`s are required.** This project has no default privileges for `authenticated`, so RLS policies alone produce `42501 permission denied` - Postgres checks privileges _before_ policies. Any new table needs an explicit `grant ... to authenticated`.

### Expiry normalization

Every platform reports expiry differently. `public/js/platforms.js` normalizes all of them into `expires_at`:

| Platform | Raw response                        | Normalized                    |
| -------- | ----------------------------------- | ----------------------------- |
| PSN      | `accessTokenExpiry` (ISO)           | used directly                 |
| Epic     | `expires_at` / `refresh_expires_at` | used directly                 |
| Xbox     | `expiresIn` seconds only            | `now + expiresIn`             |
| EA       | nothing at all                      | assumed `now + 4h`            |
| Steam    | n/a                                 | `null` + `neverExpires: true` |

Two platform quirks the client compensates for, both easy to regress:

- **Xbox refresh rotates `xstsToken` AND `userHash`**, not just the token. The whole tuple is re-persisted on every refresh or subsequent calls 401.
- **Epic burns a token refresh** resolving the account id if `epicAccountId` is omitted, so `callCredentials` always sends it.

`public/js/api.js` also absorbs the one handler inconsistency: **psn.js reads credentials from the top level of the body; every other handler expects them nested in `options`.**

### Connect flows (how a credential is captured)

Two modes, forced by the browser's same-origin policy - a popup on another
domain cannot have its URL or body read by us.

| Platform | Mode        | Why                                                                                                                |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Steam    | `openid`    | Steam OpenID 2.0 accepts an arbitrary `return_to`, so the popup redirects back to **our** origin. Fully automatic. |
| PSN      | `clipboard` | `ssocookie` renders JSON on Sony's domain. Unreadable cross-origin.                                                |
| Epic     | `clipboard` | `id/api/redirect` renders JSON on Epic's domain.                                                                   |
| EA       | `clipboard` | Implicit grant renders JSON at `nucleus:rest`.                                                                     |
| Xbox     | `clipboard` | Redirect URI is `login.live.com/oauth20_desktop.srf`, which we don't own.                                          |

**Steam (`openid`)**: `connect.js` builds the OpenID URL with
`return_to = <origin>/steam-callback.html`. That bare page postMessages the
`openid.*` params to `window.opener` and closes. The parent then calls
`steam.openid_verify`, which does the mandatory `check_authentication` handshake
with Steam server-side before trusting the SteamID64 - never trust the callback
params directly.

**Everything else (`clipboard`)**: the popup opens the credential URL (already
authenticated, so the JSON renders immediately), a modal appears, and
`awaitClipboardCredential` polls `navigator.clipboard.readText()` on window
focus. The moment the clipboard parses into a valid credential it connects and
closes the popup. Clipboard permission can be denied, so the modal **always**
keeps a manual paste field - do not remove it.

`public/js/credentials.js` holds the pure extractors (no imports, unit-testable).
Each accepts JSON, a full redirect URL, or the bare value, and returns `null`
when the text isn't a credential - that `null` is what makes clipboard polling
keep waiting instead of connecting with garbage.

**To make Xbox fully automatic**, register your own Azure app with
`<origin>/xbox-callback.html` as a redirect URI and swap `XBOX_CLIENT_ID` in
`api/xbox.js`. PSN, Epic and EA cannot be automated from a browser at all.

### Auto-refresh

`public/js/refresh.js` keeps tokens alive so you don't reconnect constantly. A
platform is refreshed when under **10 minutes** remain, checked on app boot,
every 4 minutes, on tab focus, and lazily before any API console call.

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

### Keeping the connections screen honest

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
`public/js/platforms.js` (`hasRefreshMaterial`) and
`api/_platform-refresh.js` (`hasRefreshMaterial`) decide it per platform. The
full story is below.

**EA auth URL MUST include `prompt=none`, and EA is a two-step connect.**
`ORIGIN_JS_SDK` is a JS-SDK client that is only permitted to mint a token from
an _existing_ ea.com session. Driving an interactive login through it fails with
"Your request cannot be completed. Service limitations apply." So the flow is:
sign in at `www.ea.com/login` first (`loginUrl`), then hit the authorize URL with
`prompt=none`, which returns the token silently. Removing `prompt=none` breaks it.

### EA: renewing from session cookies

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
"reconnect EA" message rather than surfaced as a raw error code; a set that is
merely missing `sid` or `_nx_mpcid` says so specifically instead.

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
stored chain is left dead. `public/js/schemas.js` omits it deliberately.

### Scheduled refresh (the thing that survives the app being closed)

`refresh.js` only runs in an open tab, so it cannot stop a refresh token lapsing
while the app is unused. `api/cron-refresh.js` closes that gap: a Vercel Cron
hits it daily at 03:00 UTC, it reads `platform_credentials` with the **service
role key** (bypassing RLS), and rolls PSN / Epic / Xbox refresh tokens forward
unconditionally. Steam and EA land in `skipped`.

It authenticates via `Authorization: Bearer ${CRON_SECRET}` - **not** the owner
JWT gate, since the caller is a machine. It always responds 200 (with per-row
detail in the body) so a single platform failing doesn't mark the cron failed,
and it never logs token values.

Refresh logic lives in `api/_platform-refresh.js`, duplicated from the handlers
because they only export a request handler. **If you change the token mapping in
`psn.js` / `epic.js` / `xbox.js`, change it here too.**

Vercel Hobby only allows daily cron granularity. That is sufficient: the job
exists to roll the long-lived _refresh_ token (PSN ~10 days), not the short
access token.

Extra env: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never shipped
to the browser).

### Mobile

Popups are unreliable on mobile, so `connect.js` switches to a **full-page
redirect** when `(pointer: coarse)` or the viewport is 820px. iOS Safari's
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
