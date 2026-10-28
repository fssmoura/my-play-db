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

- **Search pill:** tapping Search in the top-right pill splits a second glass
  pill off its left end (8px gap) that stretches left into a text field, the
  icon travelling with it; the main pill shrinks to Profile and More. Search
  mode (pill, results screen, Back circle) is one state; it ends only via Back,
  Escape or the browser's back, never by clicking away. One continuous, springy morph (~300ms, slight
  overshoot); instant under `prefers-reduced-motion`. Same glass as the main
  pill, no browser search-field chrome. A clear button (xmark in a filled circle, secondary tone) appears at the right end only while there is text. Focus rings are keyboard-only (`:focus-visible`): a mouse or touch user never sees one on a pill button.
- **Results screen:** clicking Search switches the page to a results
  screen at once, blank until something is typed. Typing runs a live search (see frontend.md): cards appear as they load (cached ones first, quiet skeletons for the rest), 20 at a time as you scroll. Each card is a plain cover tile with a faint static stroke (1px, white at the top-left and bottom-right corners, nothing between), then
  title (white, semibold, ellipsis) and a dimmer smaller "type · year" line. While loading, the same grid shows quiet skeleton cards with a soft diagonal shimmer (a slow pulse under reduced motion). A card with no cover shows #151516 with a crossed-out picture icon in #272727 centred at about 28% of the tile width. A Back glass circle (the pill's margins mirrored,
  top left) slides in with it. Empty results show one short dim centred line ("No results", or "Couldn't search. Try again."), no illustration; if IGDB fails while cached results are showing they stay, with a small grey "IGDB search failed" line under the last card. Typing and clearing
  never open or close anything; filters set before a search shape it, filters set afterwards just hide cards (see frontend.md). A glass circle with a funnel icon left of the search pill opens a pull-down (stays open, fixed width) with In Library (only games I own; not wired to results yet, its count always reads (0)), By Type (sublabel "None applied" / "N Selected", chevron; opens a second, blurrier glass panel layered over the menu, growing out of the row with a spring, header kept in place, parent dimmed behind it) and, below a divider, Clear all in red. Type rows have a leading to-do circle that gains a tick when selected (In Library keeps a trailing checkmark): Main Game, DLC, Remaster, Remake, Bundle and "See more" (dim label, dim down chevron right after it), which shows all 15. Once results are showing, each type shows its count in brackets after the label, same size but dimmer, e.g. "Main Game (39)". None selected means all types; a white count badge sits on the button's rim when any are. Only Back, Escape or the browser's back leave, restoring the
  previous page (one history entry, no stray ones). The
  look will be designed later; the behaviour sits in `search-state.js` and
  `app-shell.js`, apart from the looks (see frontend.md).
- **Game page:** tapping a result card opens a sheet that slides up from
  the bottom (HIG Sheets/Modality: the parent steps back - here it fades out - obvious way out, one at a
  time). It starts 85px from the top with the grid's 25px side inset (full width on phones), 24px top
  corners only, fill the page black `--black` `#09090B`, and the
  result cards' light edge stroke scaled up and kept subtle. The search pill and
  filter circle fold away while it is open but search is kept intact; the main
  pill and the Back circle stay. Back, Escape and the browser's back close it
  and return to the results as they were (same text, filter and scroll
  position); Search in the main pill does too; dragging it down dismisses it
  (past a quarter of its height or a quick flick). The game page is its own page:
  its address is `/?game=<id>` alone. **Leaving a page fades its content out
  (not a dim), and returning fades it back in**, smoothly, in step with whatever
  covers it; this is the rule for every future page. The only content is the game's banner, when it has one (nothing at all otherwise): full width, Figma ratio 439/238 (capped at 420px tall on wide desktop sheets - a judgement call), a fade made by masking the image itself (the Figma radial shape multiplied by an eased vertical fade that reaches fully transparent at the bottom edge, over a `--black` banner background), so it ends in exactly the sheet's black with no partial band so it dissolves into the sheet while staying clear through most of the image.
    The page scrolls as one: the sheet first rises from 85px to the top of the screen, then its content scrolls; the banner is sticky at the top, so content dissolves under its gradient. The sheet is exactly screen-high when empty, so nothing scrolls until real content makes it taller.
  - **Bottom toolbar (game page only):** a floating glass capsule, centred, 25px above the bottom (plus the safe area), rising from below the bottom edge on its own spring once the sheet has settled and loading has ended (hidden during the skeleton; leaves with the sheet; plain appear under reduced motion). Items are icon over a small label (data-driven list, one item "Customize" that does nothing yet). **Expanded** (icon + label) when the sheet opens; **compact** (smaller icons only, smaller capsule) after scrolling either way (more than 8px). HIG (Tab bars): a minimised bar is restored by tapping it or scrolling back to the top - scrolling up alone does not restore it, so that is what we do. Expanded, the label has 22px of padding each side and 3px sits between icon and label. Tapping a compact bar only expands it; it does not trigger the item.
  - **Game page loading:** while the page resolves its art (row read, detail pull, SteamGridDB lookup) the whole sheet shows the shared shimmer (a sheet-level `is-loading` state, not tied to the banner; edge stroke kept; pulse under reduced motion). When done, the content (banner or nothing) crossfades in and the shimmer fades out. No fake text bars.
  - **Game page scrollbar:** the overlay indicator starts just below the banner's bottom edge (where the scrollable content is), follows it as the sheet rises, and runs to the bottom inset. No banner: it starts below the top bar.
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
