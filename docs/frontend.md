# Frontend

Structure of the `public/` SPA and the styling rules. Read this before changing
anything under `public/`.

`public/` is a vanilla ES-module SPA. No bundler, no framework, no build step -
the browser loads the files as written, so editing them is immediate.

Two tabs behind a Google login gate:

- **Connections** - one row per platform: status dot, account name, expiry
  state, and buttons for connect / refresh / edit / delete. `edit` expands the
  stored record as editable JSON, so credentials can be inspected or corrected
  by hand.
- **API console** - pick a platform + action and the console builds a labelled
  form from `public/js/schemas.js`: one input per option the action accepts,
  with required markers, defaults, example values and a one-line explanation.
  Stored credentials are injected automatically and never appear as fields.
  An "edit as JSON" toggle drops back to a raw options box for anything the
  schema doesn't cover. IGDB and SGDB appear here too; they need no credentials.

  **`schemas.js` must be kept in step with the handlers.** If you add an action
  or an option, add it there too, or the console silently can't reach it. The
  field `name` must match the key the handler reads from `options`.

### Built to be replaced

This UI is scaffolding. The real design will be produced separately and
hand-coded later, possibly across different pages. So the split below is the
point of the whole structure - keep it intact.

**Reusable logic** - contains no rendering, should survive a total redesign
untouched:

`api.js` `vault.js` `session.js` `platforms.js` `credentials.js` `connect.js`
`refresh.js` `schemas.js` `config.js` `supabase.js`

**Presentation** - throwaway, rewrite freely:

`app.js` `views/connections.js` `views/console.js` `index.html` `app.css`

A different UI should be able to import the first group unchanged and get every
behaviour - connecting a platform, storing and refreshing tokens, calling any
endpoint. So: no DOM code in the logic modules, and no `fetch`/storage logic in
the views.

(`connect.js` and `refresh.js` do attach `window` listeners for `message` and
`focus`. That is inherent to popup and background-refresh handling; neither
renders or queries the DOM.)

### Styling rules (deliberate, keep them)

All CSS lives in `public/css/app.css`, numbered into ten sections with a guide
at the top. Two rules make it safe to restyle later without touching logic:

1. **No inline styles anywhere.** JavaScript writes class names only, never
   `style="..."`. An inline style would silently beat any rule in the
   stylesheet, so this keeps the CSS file authoritative.
2. **Colours only via the `:root` variables.** Changing `--bg` / `--text` /
   `--line` recolours the whole app at once.

Styling is intentionally wireframe-only: grayscale, no branding. Build
functionality first, design later. Do not add colour or polish unless asked.
