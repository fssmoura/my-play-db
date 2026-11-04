# Design rules for the new app

Applies to the new app at `/` only (sign-in, menu, and everything built there
later). The lab at `/lab/` is exempt.

## The principle

**Apple's Human Interface Guidelines (HIG) are the design authority for the new
app.** Follow them unless the owner says otherwise. The rules below are a
summary of decisions already made, not a substitute.

Page URLs are flat:
`https://developer.apple.com/design/human-interface-guidelines/<page>`. Adding
a `foundations/` or `components/` segment does **not** work. All pages below
were confirmed to resolve.

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

## Licensing: what the web can and can't use

Checked against Apple's own pages (Oct 2026):

- **SF Pro / San Francisco fonts:** Apple's font licence (shown on
  developer.apple.com/fonts) is titled "for iOS, OS X and tvOS application uses
  only" and says the font is to be used **solely for mock-ups of interfaces for
  software on Apple's operating systems**. So we must not host or ship the font
  files on the web. We use the system font stack, which renders SF on Apple devices without us distributing it.
- **SF Symbols:** the HIG page says to understand the terms and conditions,
  which prohibit using symbols (or confusingly similar images) in app icons,
  logos or other trademarked uses. The full licence text is only in the SF
  Symbols download, so treat the
  Apple-platforms-only restriction as **likely but unconfirmed**. Either way
  we do not copy SF Symbols: icons are a lookalike open set, drawn to match
  the HIG `icons` page (consistent stroke, optical size, `currentColor`).
- **Colours:** Apple's system colour values (e.g. dark-mode systemRed
  `#FF453A`) are published in the HIG `color` page and are fine to reference.
  The owner's five-colour palette stays for now for simplicity; adopting
  Apple's system colours later is open.

## Decisions so far

Rules a redesign must keep, with the HIG reason where there is one.

**Search**

- Search mode (the search field, the results page and the Back circle) is one
  state. It ends only via Back, Escape or the browser's back, never by
  clicking away, and leaving restores the previous page without adding stray
  history entries.
- The search field grows out of the existing menu pill as one continuous
  morph, in the same glass, with no browser search-field chrome. A clear
  button shows only while there is text.
- Typing and clearing never open or close anything. The results page appears
  as soon as Search is tapped, blank until something is typed.
- Focus rings are keyboard-only: a mouse or touch user never sees one.

**Results**

- Cards appear as they load, cached ones first, and stay put as IGDB results
  merge in. More load as you scroll.
- A card is the cover plus title and a dimmer "type - year" line. A game with
  no cover gets a quiet placeholder, not an empty hole.
- Empty and error states are one short dim line, no illustration: "No
  results" or "Couldn't search. Try again." If IGDB fails while cached results
  are showing, they stay, with a small note under the last card.

**Filter**

- A pull-down from a glass circle beside the search field (HIG pull-down
  buttons): In Library, By Type, and Clear all as a destructive action. It
  stays open while choosing.
- By Type shows a short list of the common types with "See more" for the
  rest. No types selected means all types. A badge on the button shows when a
  filter is active, and once results show, each type shows its count.
- Filters set before a search shape it, and while one is shaping it any
  filter change re-runs the search; if the search started unfiltered, filters
  set afterwards only hide cards.
- In Library is not wired to results yet.

**Game page**

- Opening a game shows a sheet sliding up over the results (HIG sheets and
  modality): one at a time, an obvious way out, and the parent steps back.
  Here the parent fades out rather than dims.
- **Leaving a page fades its content out and returning fades it back in, in
  step with whatever covers it. This is the rule for every future page.**
- The game page is its own address: `/?game=<id>` alone.
- Back, Escape, the browser's back and Search all close it, returning the
  results exactly as they were (text, filter, scroll position). Dragging it
  down dismisses it.
- While it is open the search field and filter fold away but the search is
  kept; the main pill and Back stay.
- The header (banner and logo) is sticky, so content dissolves under the
  banner as it scrolls. Banner and logo show only when the game has them.
- Logos are sized to roughly the same area whatever their shape, so wide and
  squarer logos carry similar weight; they sit centred on the banner's edge.

**Bottom toolbar (game page)**

- A floating glass capsule of icon-over-label items, appearing once the sheet
  has settled and loading has ended.
- It starts expanded and goes compact after scrolling. Following HIG tab bars,
  it is restored by tapping it or scrolling back to the top, not by scrolling
  up. Tapping a compact bar only expands it; it does not trigger the item.

**Customize drawer**

- Opened by the toolbar's Customize. It slides in from the right over
  everything, top bar included. It is full width up to 743px (the same line as
  the game sheet going edge to edge) and a side panel 40% of the window wide
  over a dimmed page above that. Back reverses the slide; Escape and tapping
  the dimmed page also close it, and closing the game page closes it at once.
- Header: Back circle, game title with "type · year" under it, a red Reset
  circle (Apple's critical colour), and a circle that reads Next (arrow) on
  Poster, Banner and Logo and Save (checkmark) on Preview. The tabs (Poster,
  Banner, Logo, Preview) sit at the bottom where the game page's toolbar is,
  text only, with the active one on a glass pill that slides between them.
  Tabs never advance on their own. Content ends above the tabs, so their glass
  sits on plain black.
- Poster, Banner and Logo are grids of every SteamGridDB image of that type,
  in SteamGridDB's order (animated and NSFW included), each with its size on
  a thin dark band at its bottom left. Posters sit in a 2:3 box: 600x900 fills
  it, any other shape is shown whole inside it. The picked one has a white
  ring; what is stored starts picked. A quiet slider just above the tabs
  (magnifiers at both ends also step it) sets images per row in a few steps,
  remembered per tab; it drags freely and glides to the nearest step on
  release; the largest banner step is one per row.
- Preview shows the picks at full size, one row per type (poster, logo,
  banner), centred as a group: name and size above each image at its two
  corners, "Add Manually +" under it (grey, white on hover). That swaps for a
  URL field of the same height with its own Save, which only shows the image
  here once it loads.
- Clicking a Preview image opens it full screen on black: wheel or pinch to
  zoom towards the pointer, double-click or double-tap to zoom in there (or
  back out), drag to move around once zoomed. The X (glass, showing only the
  image being viewed), Escape (closing only the image, not the drawer) or a
  tap beside the image closes it.
- The drawer's Save writes the changed picks, each first in its array, closes
  the drawer and the game page shows them. Nothing is written before that:
  Back drops every pick. Reset puts every pick back to what an untouched game
  gets - the IGDB poster (or SteamGridDB's first static one) and
  SteamGridDB's first static banner and logo - and shows Preview; still only
  Save writes it.
- A game SteamGridDB couldn't match (`sgdb_id` 0) shows a centred pop-up over
  the whole drawer, dimmed and out of reach, header and tabs included: the
  title in regular weight on the left, a plain close icon on the right, a
  search field pre-filled with the game's name, and SteamGridDB's results as
  "Name (year)". Choosing one links it for good (straight away, unlike image
  picks) and fills the grids; closing it leaves them showing "No Results
  Available". The pop-up is content, so it is a plain card, not glass.

**Loading**

- The game page shows a whole-sheet shimmer while it works out which art to
  show, then crossfades to the content. It never waits for image downloads:
  the banner keeps its space and each image fades in when it arrives. No fake
  text bars. Results use quiet skeleton cards with the same shimmer.
- Under reduced motion the shimmer becomes a slow pulse.

**Scrollbar**

- Native scrollbars are hidden in favour of a thin overlay indicator. On the
  game page it covers only the content that scrolls, starting below the
  banner.

**Everywhere:** honour `prefers-reduced-motion` - every animation has a plain
or instant fallback.

## Colour

Five colours, defined once as variables in `public/css/tokens.css`: white
`#FFFFFF`, light gray `#F4F4F4`, gray `#7B7B7B`, dark gray `#48484D`, black
`#09090B`. Translucent fills are rgba of a palette colour.

One deliberate exception: `--destructive` (`#FF453A`, Apple's dark-mode
systemRed), used only for critical actions (Sign Out, the filter's Clear all), error
text and the sign-in form's invalid-field ring. The
Google button also keeps Google's official dark-theme colours.

## Glass

Liquid glass is for the navigation/controls layer only (the top-right pill
menu and its pull-downs, the Back circle, the search pill, the filter circle,
panel and By Type submenu, the game page's bottom toolbar, and the Customize
drawer's Back, Reset, Next/Save, tab pill and full-screen X), never for content
such as the sign-in form. Apple
reserves it for the layer that floats above content.

**The approved look (owner signed off, October 2026) - reuse it for any new
glass control:** clear glass that keeps the colour of what is behind it,
softly blurred, with a visible bend in a band around the edge, a faint white
rim light brightest at the top-left and bottom-right, and the library's own
soft shadow. It dims itself over bright backgrounds so white text stays
readable, plus a faint dark halo on icons and labels. Rejected along the way:
grey or black tints (looked flat and dead), grainy "frost" and a strong drop
shadow. CSS fill, rim or blur layered on the lens is ruled out for technical
reasons ([frontend.md](frontend.md#liquidgl)).
Settings live in `GLASS_CONFIG` in `public/js/menu.js`; how it works, the
patched library and the gotchas are in
[frontend.md](frontend.md#liquidgl). Every new lens goes through the
same config, so it matches automatically.

## Buttons

- One visually prominent button per view; style, not size, shows which one.
- Social sign-in buttons are the same size as the primary button (Apple's and
  Google's parity rules).
- Rounded-rect in vertical stacks; capsule for navigation.
- 44px minimum hit area, including icon-only buttons.
- A custom button always has a press state.
- Disabled buttons are faded. While a request runs, the button shows an in-button
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
