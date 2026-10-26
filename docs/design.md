# Design rules for the new app

Applies to the new app at `/` only (sign-in, menu, and everything built there
later). The lab at `/lab/` is exempt.

## The principle

**Apple's Human Interface Guidelines (HIG) are the design authority for the new
app.** Before designing or changing any UI, look up the relevant HIG page
rather than recalling it, and follow it unless the owner says otherwise. The
rules below are a summary of decisions already made, not a substitute.

**How to look it up**

1. With the `sosumi` MCP (see [copilot-app.md](copilot-app.md#sosumi-mcp-apple-hig)):
   `fetchAppleDocumentation` with a path like
   `/design/human-interface-guidelines/color`, or `searchAppleDocumentation`
   when unsure of the page.
2. Without it: fetch `https://sosumi.ai/design/human-interface-guidelines/<page>`
   (same as the developer.apple.com URL with the host swapped).

Page paths are flat: `/design/human-interface-guidelines/<page>`. Adding a
`foundations/` or `components/` segment does **not** work. All pages below were
confirmed to resolve.

## Which page for what

| Need                 | Pages                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations          | `color`, `dark-mode`, `typography`, `layout`, `materials`, `icons`, `sf-symbols`, `motion`, `accessibility`, `writing`, `inclusion`, `privacy` |
| Buttons and actions  | `buttons`, `toggles`, `segmented-controls`, `menus`, `pull-down-buttons`, `context-menus`, `menus-and-actions`                                 |
| Fields and selection | `text-fields`, `labels`, `selection-and-input`                                                                                                 |
| Feedback and loading | `progress-indicators`, `alerts`, `sheets`, `popovers`                                                                                          |
| Navigation           | `toolbars`, `sidebars`, `tab-bars`, `searching`, `navigation-and-search`                                                                       |
| Content              | `lists-and-tables`, `content`, `layout-and-organization`                                                                                       |
| Patterns             | `entering-data`, `loading`, `feedback`, `managing-accounts`, `offering-help`, `launching`                                                      |
| Sign-in              | `managing-accounts`, `sign-in-with-apple`                                                                                                      |

Full URL pattern: `https://developer.apple.com/design/human-interface-guidelines/<page>`.

## Licensing: what the web can and can't use

Checked against Apple's own pages (Oct 2026):

- **SF Pro / San Francisco fonts:** Apple's font licence (shown on
  developer.apple.com/fonts) is titled "for iOS, OS X and tvOS application uses
  only" and says the font is to be used **solely for mock-ups of interfaces for
  software on Apple's operating systems**. So we must not host or ship the font
  files on the web. We use the system font stack
  (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`),
  which renders SF on Apple devices without us distributing it.
- **SF Symbols:** the HIG page says to understand the terms and conditions,
  which prohibit using symbols (or confusingly similar images) in app icons,
  logos or other trademarked uses. I could not read the full licence text
  (it is shown only inside the SF Symbols download), so treat the
  Apple-platforms-only restriction as **likely but unconfirmed**. Either way
  we do not copy SF Symbols: icons are a lookalike open set, drawn to match
  the HIG `icons` page (consistent stroke, optical size, `currentColor`).
- **Colours:** Apple's system colour values (e.g. dark-mode systemRed
  `#FF453A`) are published in the HIG `color` page and are fine to reference.
  The owner's five-colour palette stays for now for simplicity; adopting
  Apple's system colours later is open.

## Decisions so far

Summary of rules already applied (Apple's guidance, adapted).

## Colour

Five colours, defined once as variables in `public/css/tokens.css`: white
`#FFFFFF`, light gray `#F4F4F4`, gray `#7B7B7B`, dark gray `#48484D`, black
`#09090B`. Translucent fills are rgba of a palette colour.

One deliberate exception: `--destructive` (`#FF453A`, Apple's dark-mode
systemRed), used only for critical actions (Sign Out) and error text. The
Google button also keeps Google's official dark-theme colours.

## Glass

Liquid glass is for the navigation/controls layer only (the top-right pill
menu and its pull-down), never for content such as the sign-in form. Apple
reserves it for the layer that floats above content.

**The approved look (owner signed off, October 2026) - reuse it for any new
glass control:** clear glass that keeps the colour of what is behind it,
softly blurred, with a visible bend in a band around the edge, a faint white
rim light brightest at the top-left and bottom-right, and the library's own
soft shadow. It dims itself over bright backgrounds so white text stays
readable, plus a faint dark halo on icons and labels. Rejected along the way:
grey or black tints (looked flat and dead), grainy "frost", a strong drop
shadow, and any CSS fill/rim/blur layered on the lens (caused glitches).
Settings live in `GLASS_CONFIG` in `public/js/menu.js`; how it works, the
patched library and the gotchas are in
[frontend.md](frontend.md) (search "liquidGL"). Every new lens goes through the
same config, so it matches automatically.

## Buttons

- One visually prominent button per view; style, not size, shows which one.
- Social sign-in buttons are the same size as the primary button (Apple's and
  Google's parity rules).
- Rounded-rect (14px radius) in vertical stacks; capsule for navigation.
- 44px minimum hit area, including icon-only buttons.
- A custom button always has a press state (scale .98 + slight fade).
- Disabled is opacity .4. While a request runs, the button shows an in-button
  spinner and a specific label ("Signing In…"). Button labels use title case; Google's own button keeps
  Google's wording, and the form is locked.

## Fields

- Persistent label above the field (placeholders are extra, not a substitute).
- Trailing accessories (the show/hide eye) sit inside the field.
- Correct keyboard hints (`inputmode`, `autocomplete`, `autocapitalize`).
- Validate on blur and on submit, inline under the field.
- Field fill and ring are CSS variables with solid colours, so typed, focused,
  invalid and browser-autofilled states look identical apart from the text.

## Errors

Inline, in context, never alerts, never a bare "Error". Say what happened in
plain words and clear the message as soon as the user edits a field.

## Google "G"

The multicolour G is never recoloured and always sits on white (a white
circular chip on dark buttons).

## Motion

Short (about 120-200ms), springy where it opens something, and always honouring
`prefers-reduced-motion`.

## Sources

Apple HIG: [selection and input](https://developer.apple.com/design/human-interface-guidelines/selection-and-input),
[progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators),
[presentation](https://developer.apple.com/design/human-interface-guidelines/presentation),
[navigation and search](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search),
[content](https://developer.apple.com/design/human-interface-guidelines/content),
[layout and organization](https://developer.apple.com/design/human-interface-guidelines/layout-and-organization),
[menus and actions](https://developer.apple.com/design/human-interface-guidelines/menus-and-actions),
[Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple).
Google's sign-in branding guidelines cover the button and G.
