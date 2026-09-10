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

| Platform | Auto-refresh | Reconnect needed when                      |
| -------- | ------------ | ------------------------------------------ |
| PSN      | yes          | refresh token expires (~10 days idle)      |
| Epic     | yes          | refresh token expires (~1 year)            |
| Xbox     | yes          | MSA refresh token expires                  |
| Steam    | n/a          | never                                      |
| EA       | **no**       | every ~4h - `ORIGIN_JS_SDK` has no refresh |

A failed refresh is memoized in a `failed` set so a dead refresh token isn't
retried every tick; `clearFailure(id)` is called after a manual reconnect.

This only runs while a tab is open. A server-side sync job needs its own refresh pass.

**EA auth URL MUST include `prompt=none`, and EA is a two-step connect.**
`ORIGIN_JS_SDK` is a JS-SDK client that is only permitted to mint a token from
an _existing_ ea.com session. Driving an interactive login through it fails with
"Your request cannot be completed. Service limitations apply." So the flow is:
sign in at `www.ea.com/login` first (`loginUrl`), then hit the authorize URL with
`prompt=none`, which returns the token silently. Removing `prompt=none` breaks it.

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
