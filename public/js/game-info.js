// The game page's text: the heading in the top bar (name over type and first
// release date) and, under the logo, one mark per platform family. No state; builds a fresh element from a games row.
//
//   gameHeading(row)  -> HTMLElement | null (null when there is nothing to show)
//   gameInfoLine(row) -> HTMLElement | null
//
// Platforms are grouped into families so PS4 + PS5 show once; the family's
// mark names its consoles on hover. Every platform shows: any that fits no
// family goes under the last, catch-all "Other".

import { TYPES } from "/js/result-types.js";

const TYPE_LABELS = new Map(TYPES.map((t) => [t.value, t.label]));
const SVG_NS = "http://www.w3.org/2000/svg";

// Icons: single-colour SVG path data drawn in currentColor. Each viewBox is
// cropped to its drawing, so every icon is the same height (width follows).
const WINDOWS = {
  viewBox: "1.5 1.5 13 13",
  scale: 0.93,
  d: "M7.5 1.5h-6v6h6zm7 0h-6v6h6zm0 7h-6v6h6zm-7 0h-6v6h6z",
};
const ICONS = {
  steam: {
    viewBox: "2 2 19.97 20",
    scale: 1.07,
    d: "M8.21 17.32L7 16.8a2.13 2.13 0 1 0 1.17-2.93l1.28.53a1.58 1.58 0 0 1-1.22 2.92zM12 2a10 10 0 0 0-10 9.34l5.38 2.21a2.3 2.3 0 0 1 .47-.24A2.6 2.6 0 0 1 9 13.1l2.44-3.56a3.8 3.8 0 1 1 3.8 3.8h-.08l-3.51 2.5a2.77 2.77 0 0 1-5.47.68l-3.77-1.6A10 10 0 1 0 12 2M17.79 9.5a2.53 2.53 0 1 0-2.53 2.5a2.54 2.54 0 0 0 2.53-2.5m-4.42 0a1.9 1.9 0 1 1 1.9 1.91a1.9 1.9 0 0 1-1.9-1.92z",
  },
  epic: {
    viewBox: "2.5 1 19 22",
    scale: 1.07,
    d: "M4 1a1.5 1.5 0 0 0-1.5 1.5v16a.5.5 0 0 0 .297.457l9 4a.5.5 0 0 0 .406 0l9-4a.5.5 0 0 0 .297-.457v-16A1.5 1.5 0 0 0 20 1zm10.25 11.75h-1.5v-8.5h1.5zM8 18.5l4 2l4-2zM8 4.25H5.25v8.5H8v-1.5H6.75v-2H8v-1.5H6.75v-2H8zm2.5 0H8.75v8.5h1.5v-2.5h.25a1.75 1.75 0 0 0 1.75-1.75V6a1.75 1.75 0 0 0-1.75-1.75m0 4.5h-.25v-3h.25a.25.25 0 0 1 .25.25v2.5a.25.25 0 0 1-.25.25m4.25-3.25c0-.69.56-1.25 1.25-1.25h1.5c.69 0 1.25.56 1.25 1.25v2h-1.5V5.75h-1v5.5h1V9.5h1.5v2c0 .69-.56 1.25-1.25 1.25H16c-.69 0-1.25-.56-1.25-1.25zM5.5 16.25h12v-1.5h-12z",
    fillRule: "evenodd",
  },
  ea: {
    viewBox: "4.12 0 23.76 32",
    // Narrow and tall, so it reads small next to the round marks.
    scale: 1.15,
    d: "M16.786 4.146a11.7 11.7 0 0 1 4.552 1.224a11.8 11.8 0 0 1 3.609 2.792q1.499 1.734 2.286 3.953q.782 2.218.62 4.672a11.4 11.4 0 0 1-.406 2.464a12.5 12.5 0 0 1-.901 2.271a27 27 0 0 1-1.958 3.214a24 24 0 0 1-2.349 2.823a26 26 0 0 1-2.714 2.406a27 27 0 0 1-3.005 1.969l-.047.036a.3.3 0 0 1-.146.031a.44.44 0 0 1-.214-.13a.39.39 0 0 1-.067-.344a.5.5 0 0 1 .052-.083c.37-.526.672-1.073.917-1.646q.358-.867.49-1.813a.17.17 0 0 0-.052-.115a.16.16 0 0 0-.115-.052q-.525.07-1.057.083q-.53.024-1.063-.047a11.8 11.8 0 0 1-8.166-4.016a12.1 12.1 0 0 1-2.286-3.953a11.7 11.7 0 0 1-.62-4.672q.069-1.267.411-2.464c.342-1.197.526-1.536.901-2.24c.583-1.151 1.24-2.234 1.958-3.245s1.5-1.953 2.344-2.828a25.5 25.5 0 0 1 5.719-4.37l.047-.031a.3.3 0 0 1 .146-.036a.4.4 0 0 1 .214.13a.34.34 0 0 1 .083.234a.4.4 0 0 1-.016.109c-.01.031-.031.057-.052.083a8.7 8.7 0 0 0-.917 1.651a7.3 7.3 0 0 0-.484 1.807q0 .069.047.115c.047.046.073.052.115.052q.525-.07 1.057-.083c.365-.01.714.005 1.068.047zm-1.078 16.489a4.42 4.42 0 0 0 3.359-1.141c.964-.849 1.479-1.917 1.568-3.198a4.46 4.46 0 0 0-1.141-3.38a4.4 4.4 0 0 0-3.198-1.552a4.5 4.5 0 0 0-3.38 1.141a4.4 4.4 0 0 0-1.552 3.203a4.52 4.52 0 0 0 1.13 3.38c.833.964 1.906 1.484 3.214 1.547",
  },
  microsoft: {
    viewBox: "2 1 16 16",
    scale: 1.1,
    d: "M7 2.5V4H2.5a.5.5 0 0 0-.5.5v10A2.5 2.5 0 0 0 4.5 17h11a2.5 2.5 0 0 0 2.5-2.5v-10a.5.5 0 0 0-.5-.5H13V2.5A1.5 1.5 0 0 0 11.5 1h-3A1.5 1.5 0 0 0 7 2.5M8.5 2h3a.5.5 0 0 1 .5.5V4H8V2.5a.5.5 0 0 1 .5-.5m-2 8V7h3v3zm0 4v-3h3v3zm7-4h-3V7h3zm-3 4v-3h3v3z",
  },
  battlenet: {
    viewBox: "0.29 0 511.42 512",
    scale: 1.22,
    d: "M448.61 225.62c26.87.18 35.57-7.43 38.92-12.37c12.47-16.32-7.06-47.6-52.85-71.33c17.76-33.58 30.11-63.68 36.34-85.3c3.38-11.83 1.09-19 .45-20.25c-1.72 10.52-15.85 48.46-48.2 100.05c-25-11.22-56.52-20.1-93.77-23.8c-8.94-16.94-34.88-63.86-60.48-88.93C252.18 7.14 238.7 1.07 228.18.22h-.05c-13.83-1.55-22.67 5.85-27.4 11c-17.2 18.53-24.33 48.87-25 84.07c-7.24-12.35-17.17-24.63-28.5-25.93h-.18c-20.66-3.48-38.39 29.22-36 81.29c-38.36 1.38-71 5.75-93 11.23c-9.9 2.45-16.22 7.27-17.76 9.72c1-.38 22.4-9.22 111.56-9.22c5.22 53 29.75 101.82 26 93.19c-9.73 15.4-38.24 62.36-47.31 97.7c-5.87 22.88-4.37 37.61.15 47.14c5.57 12.75 16.41 16.72 23.2 18.26c25 5.71 55.38-3.63 86.7-21.14c-7.53 12.84-13.9 28.51-9.06 39.34c7.31 19.65 44.49 18.66 88.44-9.45c20.18 32.18 40.07 57.94 55.7 74.12a39.8 39.8 0 0 0 8.75 7.09c5.14 3.21 8.58 3.37 8.58 3.37c-8.24-6.75-34-38-62.54-91.78c22.22-16 45.65-38.87 67.47-69.27c122.82 4.6 143.29-24.76 148-31.64c14.67-19.88 3.43-57.44-57.32-93.69m-77.85 106.22c23.81-37.71 30.34-67.77 29.45-92.33c27.86 17.57 47.18 37.58 49.06 58.83c1.14 12.93-8.1 29.12-78.51 33.5M216.9 387.69c9.76-6.23 19.53-13.12 29.2-20.49c6.68 13.33 13.6 26.1 20.6 38.19c-40.6 21.86-68.84 12.76-49.8-17.7m215-171.35c-10.29-5.34-21.16-10.34-32.38-15.05a723 723 0 0 0 22.74-36.9c39.06 24.1 45.9 53.18 9.64 51.95M279.18 398c-5.51-11.35-11-23.5-16.5-36.44c43.25 1.27 62.42-18.73 63.28-20.41c0 .07-25 15.64-62.53 12.25a719 719 0 0 0 85.06-84q13.06-15.31 24.93-31.11c-.36-.29-1.54-3-16.51-12c-51.7 60.27-102.34 98-132.75 115.92c-20.59-11.18-40.84-31.78-55.71-61.49c-20-39.92-30-82.39-31.57-116.07c12.3.91 25.27 2.17 38.85 3.88c-22.29 36.8-14.39 63-13.47 64.23c0-.07-.95-29.17 20.14-59.57a695.2 695.2 0 0 0 44.67 152.84c.93-.38 1.84.88 18.67-8.25c-26.33-74.47-33.76-138.17-34-173.43c20-12.42 48.18-19.8 81.63-17.81c44.57 2.67 86.36 15.25 116.32 30.71q-10.69 15.66-23.33 32.47C365.63 152 339.1 145.84 337.5 146c.11 0 25.9 14.07 41.52 47.22a717.6 717.6 0 0 0-115.34-31.71a647 647 0 0 0-39.39-6.05c-.07.45-1.81 1.85-2.16 20.33C300 190.28 358.78 215.68 389.36 233c.74 23.55-6.95 51.61-25.41 79.57c-24.6 37.31-56.39 67.23-84.77 85.43m27.4-287c-44.56-1.66-73.58 7.43-94.69 20.67c2-52.3 21.31-76.38 38.21-75.28C267 52.15 305 108.55 306.58 111m-130.65 3.1c.48 12.11 1.59 24.62 3.21 37.28c-14.55-.85-28.74-1.25-42.4-1.26c-.08 3.24-.12-51 24.67-49.59h.09c5.76 1.09 10.63 6.88 14.43 13.57m-28.06 162c20.76 39.7 43.3 60.57 65.25 72.31c-46.79 24.76-77.53 20-84.92 4.51c-.2-.21-11.13-15.3 19.67-76.81zm210.06 74.8",
  },
  riot: {
    viewBox: "1.5 1 21.5 22",
    d: "M15 1L1.5 7.5l2 9.5H6v-7l2 7h2.5V8.5l2 8.5h3L16 7h.5l1 10h4L23 3zm-3.5 17.5l9.5.5l-.5 4l-8-2z",
    fillRule: "evenodd",
  },
  rockstar: {
    viewBox: "0.03 0 23.95 24",
    scale: 1.1,
    d: "M5.971 6.816h3.241c1.469 0 2.741-.448 2.741-2.084c0-1.3-1.117-1.576-2.19-1.576H6.748zm12.834 8.753h5.168l-4.664 3.228l.755 5.087l-4.041-3.07L10.599 24l2.536-5.392s-2.95-3.075-2.947-3.075c-.198-.262-.265-.936-.265-1.226c0-.367.024-.739.049-1.134c.028-.451.058-.933.058-1.476c0-1.338-.59-2.038-2.036-2.038H5.283l-1.18 5.525H.026L3.269 0h7.672c2.852 0 5.027.702 5.027 3.936c0 2.276-1.12 3.894-3.592 4.233v.045c1.162.276 1.598 1.062 1.598 2.527c0 .585-.018 1.098-.034 1.581c-.015.428-.03.834-.03 1.243c0 .525.137 1.382.48 1.968h.567l3.028-5.06zm-1.233-2.948l-2.187 3.654h-3.457l2.103 2.189l-1.73 3.672l3.777-2.218l2.976 2.263l-.553-3.731l3.093-2.139h-3.43z",
  },
  // Console wordmarks for tooltips: wide and short, sized to read like text.
  ps5: {
    viewBox: "0 9.42 23.99 5.15",
    scale: 0.62,
    d: "M10.45 14.57a1.383 1.383 0 0 0 1.383-1.384v-2.378a.833.833 0 0 1 .834-.833h2.684a.037.037 0 0 0 .036-.038v-.476a.036.036 0 0 0-.036-.036h-3.234a1.383 1.383 0 0 0-1.384 1.383v2.38a.834.834 0 0 1-.833.834H7.253a.036.036 0 0 0-.036.037v.476a.036.036 0 0 0 .036.036zm6.045-3.213V9.461a.036.036 0 0 1 .036-.036h7.308a.037.037 0 0 1 .037.036v.476a.04.04 0 0 1-.037.038h-6.21a.036.036 0 0 0-.036.036v1.236a.395.395 0 0 0 .397.397h4.622a1.465 1.465 0 0 1 0 2.925h-6.08a.036.036 0 0 1-.037-.036v-.474a.036.036 0 0 1 .036-.037h5.53a.916.916 0 1 0-.007-1.83h-4.726a.833.833 0 0 1-.833-.835m-10.846.287a.835.835 0 0 0 0-1.67H.037A.037.037 0 0 1 0 9.938v-.476a.036.036 0 0 1 .037-.036h6.152a1.384 1.384 0 0 1 0 2.767H1.933a.833.833 0 0 0-.833.834v1.513a.036.036 0 0 1-.037.036H.037a.036.036 0 0 1-.037-.04v-1.513a1.383 1.383 0 0 1 1.384-1.378Z",
  },
  ps4: {
    viewBox: "0 9.44 24 5.13",
    scale: 0.62,
    d: "M12.302 13.18v-2.387c0-.486.227-.834.712-.834h2.99c.017 0 .035-.018.035-.036v-.475q0-.006-.003-.012h-3.66c-.792.1-1.18.653-1.18 1.357v2.386c0 .482-.233.831-.71.831H7.332c-.018 0-.036.012-.036.036v.475q.002.031.023.04h3.584c.933-.025 1.393-.62 1.393-1.385zM.024 14.564h1.05a.04.04 0 0 0 .025-.04v-1.52c0-.487.275-.823.676-.823h4.323c.974 0 1.445-.6 1.445-1.384c0-.705-.386-1.257-1.18-1.357H.006c0 .003-.006.005-.006.01v.475q0 .036.037.036h5.697c.484 0 .712.35.712.833c0 .484-.227.836-.712.836H1.226c-.7 0-1.226.592-1.226 1.373v1.519c0 .02.01.036.028.04zm15.998-.55h5.738c.017 0 .03.012.03.024v.483c0 .024.017.036.035.036h1.035c.018 0 .036-.01.036-.036v-.475c0-.018.02-.036.04-.036h1.028c.024 0 .036-.018.036-.036v-.484c0-.018-.01-.036-.035-.036h-1.03c-.02 0-.037-.017-.037-.035V9.96c0-.283-.104-.463-.28-.523h-.3a1.2 1.2 0 0 0-.303.132l-6.18 3.815c-.24.15-.323.318-.263.445c.048.104.185.182.454.182zm.895-.637l4.79-2.961c.03-.024.09-.018.09.048v2.961c0 .018-.016.036-.034.036h-4.817c-.04 0-.06-.012-.065-.024q-.01-.034.036-.06",
  },
  ps3: {
    viewBox: "0 9.43 24 5.14",
    scale: 0.62,
    d: "M15.362 9.433h-3.148c-.97 0-1.446.6-1.446 1.38v2.365c0 .483-.228.83-.71.83H7.304a.035.035 0 0 0-.035.035v.47q0 .031.03.032h3.11c.97 0 1.45-.597 1.45-1.377v-2.363c0-.484.224-.832.71-.832h2.781c.02 0 .04-.014.04-.033v-.475c0-.02-.02-.035-.04-.035zm-9.266 0H.038c-.022 0-.038.017-.038.035v.477c0 .02.016.036.038.036h5.694c.48 0 .71.347.71.83s-.228.83-.71.83H1.228c-.7 0-1.227.586-1.227 1.365v1.513c0 .02.02.037.04.037h1.03c.02 0 .04-.016.04-.037v-1.513c0-.48.28-.82.68-.82H6.1c.97 0 1.444-.594 1.444-1.374c0-.778-.473-1.38-1.442-1.38zm17.453 2.498a.04.04 0 0 1 0-.056c.3-.25.45-.627.45-1.062c0-.778-.474-1.38-1.446-1.38h-6.057c-.02 0-.036.018-.036.038v.475c0 .02.02.04.04.04h5.7c.48 0 .715.35.715.83s-.23.83-.712.83h-5.7c-.02 0-.036.02-.036.04v.48c0 .02.016.033.037.033h5.7c.63.007.71.62.71.93v.06c0 .485-.23.833-.71.833h-5.7c-.02 0-.036.015-.036.034v.477c0 .02.015.037.036.037h6.05c.973 0 1.446-.645 1.446-1.38v-.057c0-.47-.15-.916-.45-1.19z",
  },
  psp: {
    viewBox: "0 9.93 24 4.14",
    scale: 0.5,
    d: "M0 9.93v.296h7.182v1.626H.001v2.217h.295v-1.921h7.182V9.93zm11.29 0v3.844H7.478v.296h4.124v-3.844h3.813V9.93zm5.233 0v.296h7.182v1.626h-7.182v2.217h.296v-1.921H24V9.93z",
  },
  ps2: {
    viewBox: "0 9.93 24 4.14",
    scale: 0.5,
    d: "M7.46 13.779v.292h4.142v-3.85h3.796V9.93h-4.115v3.85zm16.248-3.558v1.62h-7.195v2.23H24v-.292h-7.168v-1.646H24V9.929h-7.487v.292zm-16.513 0v1.62H0v2.23h.292v-1.938H7.46V9.929H0v.292Z",
  },
  vita: {
    viewBox: "0 10 24 4",
    scale: 0.5,
    d: "M3.176 12.216H1.274c-.26 0-.453.198-.453.538v1.235H0v-1.19c0-.668.42-1.119 1.014-1.119h1.924c.471-.018.584-.252.584-.592c0-.26-.13-.616-.584-.58H0v-.49h3.176c.832 0 1.16.481 1.16 1.07c0 .669-.328 1.128-1.16 1.128m3.488-1.122v1.813c0 .663-.299 1.076-1.126 1.076H3.761v-.49h1.55c.318 0 .507-.258.507-.586v-1.813c0-.578.28-1.077 1.102-1.077h1.765v.49H7.158c-.412-.017-.494.32-.494.587m4.84 2.904c-.331-.018-.47-.27-.532-.377s-1.92-3.609-1.92-3.609h.924l1.538 2.855c.08.16.262.2.36.012l1.53-2.867h.577s-1.798 3.404-1.87 3.52c-.071.117-.276.484-.607.466m3.005-3.972h.84v3.96h-.84zm3.77.46l.003 3.477h-.826V10.49l-1.57-.002v-.483L19.859 10l-.002.489zm3.235-.481c-.314.005-.51.354-.579.467c-.071.116-1.873 3.527-1.873 3.527h.578l.44-.84h2.541l.454.84H24s-1.86-3.508-1.923-3.616c-.062-.107-.201-.36-.533-.378zm-.18.996c.078-.005.155.047.2.138l.825 1.525h-2.004l.818-1.538c.043-.082.102-.12.162-.125Z",
  },
  switch: {
    viewBox: "2.03 2 19.94 20",
    d: "M21.9 6.22a5.125 5.125 0 0 0-4.204-4.146a16 16 0 0 0-2.171-.062c-.991 0-1.817.013-1.829.029s-.029 4.489-.029 9.948c0 9.008 0 9.92.065 9.949c.112.041 3.316.024 3.718-.017a5.16 5.16 0 0 0 3.96-2.725a6 6 0 0 0 .31-.723c.259-.777.251-.57.251-6.504c-.005-4.741-.013-5.447-.071-5.749m-2.412 7.416a2.003 2.003 0 0 1-3.818-.1a2.360 2.360 0 0 1 .016-1.164a2.002 2.002 0 0 1 3.803-.05a2.17 2.17 0 0 1 0 1.314ZM6.65 6.146a2.2 2.2 0 0 0-.867.433a1.83 1.83 0 0 0-.615 1.536a1.3 1.3 0 0 0 .169.678a1.9 1.9 0 0 0 .888.892a1.3 1.3 0 0 0 .704.165a1.5 1.5 0 0 0 .663-.076A1.864 1.864 0 0 0 8.881 7.71A1.9 1.9 0 0 0 6.65 6.146m2.461-4.13a27 27 0 0 0-2.813.062A5.16 5.16 0 0 0 2.21 5.836c-.182.698-.194 1.106-.174 6.52c.012 4.973.017 5.088.1 5.472a5.18 5.18 0 0 0 4.02 4.031a18 18 0 0 0 2.853.086a11 11 0 0 0 2.613-.049c.061-.062.065-.859.065-9.895c0-6.697-.012-9.848-.041-9.91c-.044-.075-.115-.079-2.535-.075m.922 9.968v8.371l-1.681-.021a8.7 8.7 0 0 1-2.023-.1a3.51 3.51 0 0 1-2.594-2.701c-.09-.417-.09-10.692 0-11.1a3.55 3.55 0 0 1 2.131-2.558a5.9 5.9 0 0 1 2.564-.249h1.599Z",
  },
  wii: {
    viewBox: "0 8.35 32 15.3",
    scale: 0.75,
    d: "M23.87 8.349a1.757 1.757 0 0 0-1.792 1.724v.021a1.773 1.773 0 0 0 1.792 1.745c1.047 0 1.875-.776 1.875-1.745c0-.974-.828-1.745-1.875-1.745m6.281 0c-.995 0-1.813.771-1.813 1.745c0 .948.818 1.745 1.813 1.745c1.026 0 1.849-.776 1.849-1.745c0-.974-.823-1.745-1.849-1.745m-19.786.724c-.995 0-1.667.5-2.016 1.62c-.323 1.141-2.396 9.094-2.396 9.094L3.239 9.198h-3.24s3.115 11.281 3.536 12.604c.323 1.021 1.12 1.849 2.266 1.849c1.344 0 1.974-.974 2.245-1.849c.302-.901 2.318-8.344 2.318-8.344s2.021 7.448 2.292 8.344c.302.875.922 1.849 2.245 1.849c1.172 0 1.943-.828 2.292-1.849c.422-1.318 3.542-12.604 3.542-12.604h-3.266l-2.693 10.589s-2.068-7.953-2.417-9.094c-.323-1.125-1.026-1.62-1.995-1.62zm12.01 4.484v9.99h3.099v-9.99zm6.26 0v9.99h3.089v-9.99z",
  },
  gamecube: {
    viewBox: "1.97 0 28.05 32.01",
    scale: 1.1,
    d: "m9.088 20.172l6.272 3.62v-7.245l-6.277-3.62v7.245zm-2.703 1.557l8.975 5.177v5.093L1.973 24.275V8.822l4.412 2.547zM16 8.193l-6.271 3.624L16 15.437l6.271-3.62L16 8.197zm0-3.11l7.547 4.371l4.412-2.547L16 0L2.631 7.719l4.411 2.541zm9.609 16.646v-5.265l-2.697 1.557v2.151l-6.272 3.625v-7.245l13.387-7.724v15.448L16.64 32.005v-5.088z",
  },
  gameboy: {
    viewBox: "3.25 1.25 17.5 21.5",
    fillRule: "evenodd",
    d: "M20.75 1.25H3.25v21.5h17.5zm-3 3H6.25v8.5h11.5zm-9.625 11v1.625H6.5v1.75h1.625v1.625h1.75v-1.625H11.5v-1.75H9.875V15.25zM18 15h-2v2h2zm-2 3.5h-2v2h2z",
  },
  nintendo: {
    viewBox: "0 0.8 32 30.4",
    scale: 0.85,
    d: "M0 .803h9.469L22.598 22V.803h9.401v30.395h-9.385L9.411 10.001v21.197H-.001z",
  },
  mac: {
    viewBox: "163 96 699 832.03",
    scale: 1.12,
    d: "M747.4 535.7c-.4-68.2 30.5-119.6 92.9-157.5c-34.9-50-87.7-77.5-157.3-82.8c-65.9-5.2-138 38.4-164.4 38.4c-27.9 0-91.7-36.6-141.9-36.6C273.1 298.8 163 379.8 163 544.6c0 48.7 8.9 99 26.7 150.8c23.8 68.2 109.6 235.3 199.1 232.6c46.8-1.1 79.9-33.2 140.8-33.2c59.1 0 89.7 33.2 141.9 33.2c90.3-1.3 167.9-153.2 190.5-221.6c-121.1-57.1-114.6-167.2-114.6-170.7m-105.1-305c50.7-60.2 46.1-115 44.6-134.7c-44.8 2.6-96.6 30.5-126.1 64.8c-32.5 36.8-51.6 82.3-47.5 133.6c48.4 3.7 92.6-21.2 129-63.7",
  },
  linux: {
    viewBox: "12.43 2.9 103.14 122.2",
    scale: 1.12,
    fillRule: "evenodd",
    d: "M113.823 104.595c-1.795-1.478-3.629-2.921-5.308-4.525c-1.87-1.785-3.045-3.944-2.789-6.678c.147-1.573-.216-2.926-2.113-3.452c.446-1.154.864-1.928 1.033-2.753c.188-.92.178-1.887.204-2.834c.264-9.960-3.334-18.691-8.663-26.835c-2.454-3.748-5.017-7.429-7.633-11.066c-4.092-5.688-5.559-12.078-5.633-18.981a47.6 47.6 0 0 0-1.081-9.475C80.527 11.956 77.291 7.233 71.422 4.7c-4.497-1.942-9.152-2.327-13.901-1.084c-6.901 1.805-11.074 6.934-10.996 14.088c.074 6.885.417 13.779.922 20.648c.288 3.893-.312 7.252-2.895 10.34c-2.484 2.969-4.706 6.172-6.858 9.397c-1.229 1.844-2.317 3.853-3.077 5.931c-2.07 5.663-3.973 11.373-7.276 16.5c-1.224 1.9-1.363 4.026-.494 6.199c.225.563.363 1.429.089 1.882c-2.354 3.907-5.011 7.345-10.066 8.095c-3.976.591-4.172 1.314-4.051 5.413c.1 3.337.061 6.705-.28 10.021c-.363 3.555.008 4.521 3.442 5.373c7.924 1.968 15.913 3.647 23.492 6.854c3.227 1.365 6.465.891 9.064-1.763c2.713-2.771 6.141-3.855 9.844-3.859c6.285-.005 12.572.298 18.86.369c1.702.02 2.679.653 3.364 2.199c.84 1.893 2.26 3.284 4.445 3.526c4.193.462 8.013-.16 11.19-3.359c3.918-3.948 8.436-7.066 13.615-9.227c1.482-.619 2.878-1.592 4.103-2.648c2.231-1.922 2.113-3.146-.135-5M62.426 24.12c.758-2.601 2.537-4.289 5.243-4.801c2.276-.43 4.203.688 5.639 3.246c1.546 2.758 2.054 5.64.734 8.658c-1.083 2.474-1.591 2.707-4.123 1.868c-.474-.157-.937-.343-1.777-.652c.708-.594 1.154-1.035 1.664-1.382c1.134-.772 1.452-1.858 1.346-3.148c-.139-1.694-1.471-3.194-2.837-3.175c-1.225.017-2.262 1.167-2.4 2.915c-.086 1.089.095 2.199.173 3.589c-3.446-1.023-4.711-3.525-3.662-7.118m-12.75-2.251c1.274-1.928 3.197-2.314 5.101-1.024c2.029 1.376 3.547 5.256 2.763 7.576c-.285.844-1.127 1.5-1.716 2.241l-.604-.374c-.23-1.253-.276-2.585-.757-3.733c-.304-.728-1.257-1.184-1.919-1.762c-.622.739-1.693 1.443-1.757 2.228c-.088 1.084.477 2.28.969 3.331c.311.661 1.001 1.145 1.713 1.916l-1.922 1.51c-3.018-2.7-3.915-8.82-1.871-11.909M87.34 86.075c-.203 2.604-.5 2.713-3.118 3.098c-1.859.272-2.359.756-2.453 2.964a102 102 0 0 0-.012 7.753c.061 1.77-.537 3.158-1.755 4.393c-6.764 6.856-14.845 10.105-24.512 8.926c-4.17-.509-6.896-3.047-9.097-6.639c.98-.363 1.705-.607 2.412-.894c3.122-1.27 3.706-3.955 1.213-6.277c-1.884-1.757-3.986-3.283-6.007-4.892c-1.954-1.555-3.934-3.078-5.891-4.629c-1.668-1.323-2.305-3.028-2.345-5.188c-.094-5.182.972-10.03 3.138-14.747c1.932-4.209 3.429-8.617 5.239-12.885c.935-2.202 1.906-4.455 3.278-6.388c1.319-1.854 2.134-3.669 1.988-5.94c-.084-1.276-.016-2.562-.016-3.843l.707-.352c1.141.985 2.302 1.949 3.423 2.959c4.045 3.646 7.892 3.813 12.319.67c1.888-1.341 3.93-2.47 5.927-3.652c.497-.294 1.092-.423 1.934-.738c2.151 5.066 4.262 10.033 6.375 15c1.072 2.524 1.932 5.167 3.264 7.547c2.671 4.775 4.092 9.813 4.07 15.272c-.012 2.83.137 5.67-.081 8.482",
  },
  mobile: {
    viewBox: "144 64 352 512",
    scale: 1.1,
    d: "M144 128c0-35.3 28.7-64 64-64h224c35.3 0 64 28.7 64 64v384c0 35.3-28.7 64-64 64H208c-35.3 0-64-28.7-64-64zm112 376c0 13.3 10.7 24 24 24h80c13.3 0 24-10.7 24-24s-10.7-24-24-24h-80c-13.3 0-24 10.7-24 24m176-376H208v304h224z",
  },
  // An outline: drawn with a line of `stroke` width rather than filled.
  vr: {
    viewBox: "2 5 20 14",
    scale: 0.88,
    stroke: 2,
    d: "M3 10c0-3 2-4 5-4h8c3 0 5 1 5 4v3c0 3-2 5-4 5s-3-3-5-3s-3 3-5 3s-4-2-4-5Z",
  },
  browser: {
    viewBox: "1 1 22 22",
    stroke: 2,
    d: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M8 12a4 10 0 1 0 8 0a4 10 0 1 0-8 0M2 12h20",
  },
  more: {
    // Kept square: the dots are a thin strip, sized as if a full icon.
    viewBox: "0 0 24 24",
    d: "M2 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  },
};

// In display order; a platform goes to the first family whose `match` takes it.
// `owns` says which library copies ({ platform, version }) are of this family.
const FAMILIES = [
  {
    key: "pc",
    label: "PC (Windows)",
    icon: WINDOWS,
    match: (p) => p.id === 6 || p.id === 13,
    owns: (c) => c.platform === "pc",
  },
  {
    key: "playstation",
    label: "PlayStation",
    icon: {
      viewBox: "0 2 16 12.35",
      d: "M15.858 11.451c-.313.395-1.079.676-1.079.676l-5.696 2.046v-1.509l4.192-1.493c.476-.17.549-.412.162-.538c-.386-.127-1.085-.09-1.56.08l-2.794.984v-1.566l.161-.054s.807-.286 1.942-.412c1.135-.125 2.525.017 3.616.43c1.23.39 1.368.962 1.056 1.356M9.625 8.883v-3.86c0-.453-.083-.87-.508-.988c-.326-.105-.528.198-.528.65v9.664l-2.606-.827V2c1.108.206 2.722.692 3.59.985c2.207.757 2.955 1.7 2.955 3.825c0 2.071-1.278 2.856-2.903 2.072Zm-8.424 3.625C-.061 12.15-.271 11.41.304 10.984c.532-.394 1.436-.69 1.436-.69l3.737-1.33v1.515l-2.69.963c-.474.17-.547.411-.161.538c.386.126 1.085.09 1.56-.08l1.29-.469v1.356l-.257.043a8.45 8.45 0 0 1-4.018-.323Z",
    },
    match: (p) => /playstation/i.test(p.name) && !/\bvr/i.test(p.name),
    owns: (c) => c.platform === "playstation",
    // Shown as wordmarks in the tooltip.
    consoles: [
      { id: 167, version: "ps5", label: "PlayStation 5", icon: ICONS.ps5 },
      { id: 48, version: "ps4", label: "PlayStation 4", icon: ICONS.ps4 },
      { id: 46, label: "PlayStation Vita", icon: ICONS.vita },
      { id: 9, version: "ps3", label: "PlayStation 3", icon: ICONS.ps3 },
      { id: 38, label: "PlayStation Portable", icon: ICONS.psp },
      { id: 8, label: "PlayStation 2", icon: ICONS.ps2 },
    ],
  },
  {
    key: "xbox",
    label: "Xbox",
    icon: {
      viewBox: "2 2 19.99 20",
      d: "M11 21.96c-1.54-.15-3.1-.7-4.44-1.57c-1.12-.73-1.38-1.03-1.38-1.63c0-1.21 1.33-3.32 3.6-5.73c1.29-1.37 3.08-2.97 3.28-2.93c.38.08 3.4 3.03 4.53 4.41c1.79 2.19 2.61 3.99 2.19 4.79c-.32.61-2.29 1.8-3.73 2.25c-1.19.38-2.76.54-4.05.41M3.67 17.5c-.93-1.43-1.4-2.84-1.63-4.88c-.08-.67-.05-1.06.17-2.44c.27-1.72 1.25-3.71 2.43-4.93c.5-.52.55-.53 1.16-.33c.74.25 1.53.8 2.76 1.91l.72.65l-.39.48c-1.82 2.23-3.74 5.4-4.46 7.36c-.39 1.06-.55 2.13-.38 2.58c.11.3 0 .19-.37-.4Zm16.37.24c.09-.45-.02-1.28-.3-2.11c-.59-1.8-2.57-5.16-4.38-7.44l-.57-.72l.62-.57c.81-.74 1.37-1.18 1.97-1.56c.48-.3 1.16-.56 1.45-.56c.18 0 .82.66 1.33 1.38c.8 1.12 1.38 2.47 1.68 3.88c.19.91.21 2.86.03 3.77c-.15.75-.45 1.71-.75 2.37c-.23.49-.78 1.44-1.02 1.75q-.13.16-.06-.18Zm-8.87-13.3c-.84-.43-2.13-.88-2.84-1c-.25-.04-.68-.07-.95-.05c-.59.03-.56 0 .38-.45c.79-.37 1.44-.59 2.33-.78c1-.21 2.88-.21 3.87 0c1.06.22 2.31.69 3.02 1.12l.21.13l-.48-.02c-.96-.05-2.35.34-3.85 1.07c-.45.22-.84.39-.87.39s-.4-.18-.82-.4Z",
    },
    match: (p) => /xbox/i.test(p.name),
  },
  {
    key: "switch",
    label: "Nintendo Switch",
    icon: ICONS.switch,
    match: (p) => /switch/i.test(p.name),
  },
  {
    key: "wii",
    label: "Wii",
    icon: ICONS.wii,
    match: (p) => /\bwii\b/i.test(p.name),
  },
  {
    key: "gamecube",
    label: "GameCube",
    icon: ICONS.gamecube,
    match: (p) => /gamecube/i.test(p.name),
  },
  {
    key: "gameboy",
    label: "Game Boy",
    icon: ICONS.gameboy,
    match: (p) => /game boy/i.test(p.name),
  },
  // Every other Nintendo system: NES, SNES, N64, DS, 3DS and the rarer ones.
  {
    key: "nintendo",
    label: "Nintendo",
    icon: ICONS.nintendo,
    match: (p) =>
      /nintendo|famicom|family computer|virtual boy|satellaview|pok[eé]mon mini|game & watch/i.test(
        p.name,
      ),
  },
  { key: "mac", label: "Mac", icon: ICONS.mac, match: (p) => p.id === 14 },
  { key: "linux", label: "Linux", icon: ICONS.linux, match: (p) => p.id === 3 },
  {
    key: "mobile",
    label: "Mobile",
    icon: ICONS.mobile,
    match: (p) => p.id === 34 || p.id === 39,
  },
  {
    key: "vr",
    label: "VR",
    icon: ICONS.vr,
    match: (p) =>
      /\bvr|steamvr|quest|oculus|mixed reality|daydream|visionos/i.test(p.name),
  },
  {
    key: "browser",
    label: "Web Browser",
    icon: ICONS.browser,
    match: (p) => /web browser/i.test(p.name),
  },
  {
    key: "other",
    label: "Other",
    icon: ICONS.more,
    match: () => true,
  },
];

// IGDB ids, newest first: PlayStation 5, 4, Vita, 3, PSP, 2, 1; Xbox Series
// X|S, One, 360, original; Switch 2, Switch; Wii U, Wii; Game Boy Advance,
// Color, original; New 3DS, 3DS, DSi, DS, N64, Virtual Boy, SNES, NES.
// Tooltips list consoles in this order; others last.
const NEWEST_FIRST = [
  167, 48, 46, 9, 38, 8, 7, 169, 49, 12, 11, 508, 130, 41, 5, 24, 22, 33, 137,
  37, 159, 20, 4, 87, 19, 18,
];
const age = (id) => {
  const i = NEWEST_FIRST.indexOf(id);
  return i < 0 ? NEWEST_FIRST.length : i;
};

// Owned PC copies show their stores in place of the Windows mark, in this
// order. The Xbox app's store is Windows' own; a copy with no store recorded
// (a launcher Windows saw) adds none.
const STORES = [
  { version: "steam", label: "Steam", icon: ICONS.steam },
  { version: "epic", label: "Epic Games Store", icon: ICONS.epic },
  { version: "ea", label: "EA/Origin", icon: ICONS.ea },
  { version: "microsoft", label: "Microsoft Store", icon: ICONS.microsoft },
  { version: "battlenet", label: "Battle.net", icon: ICONS.battlenet },
  { version: "riot", label: "Riot Games", icon: ICONS.riot },
  { version: "rockstar", label: "Rockstar Launcher", icon: ICONS.rockstar },
];

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function firstRelease(row) {
  if (typeof row.first_release_date === "number") return row.first_release_date;
  const dates = (row.release_dates ?? [])
    .map((r) => r.date)
    .filter((d) => typeof d === "number");
  return dates.length ? Math.min(...dates) : null;
}

// Each platform goes to the first family it matches, so the catch-all only
// gets what nothing else took. A family the game is owned on shows even if
// IGDB doesn't list it.
function families(platforms, copies) {
  const byKey = new Map();
  for (const p of platforms ?? []) {
    if (!p) continue;
    const family = FAMILIES.find((f) => f.match(p));
    if (!byKey.has(family.key)) byKey.set(family.key, []);
    byKey.get(family.key).push(p);
  }
  return FAMILIES.map((f) => ({
    ...f,
    platforms: byKey.get(f.key) ?? [],
    names: (byKey.get(f.key) ?? []).map((p) => p.name),
    owned: f.owns ? copies.filter(f.owns) : [],
  })).filter((f) => byKey.has(f.key) || f.owned.length);
}

function metaText(row) {
  const type = TYPE_LABELS.get(row.game_type);
  const released = firstRelease(row);
  return [type, released != null ? DATE.format(released * 1000) : null]
    .filter(Boolean)
    .join(" · ");
}

// Five stars filled to IGDB's rating (0-100, with the owner's own vote counted
// in), then the number and a vote-count tooltip; then "Trending #X" when the
// game is on the popular list. The stars are also the owner's voting control:
// hovering lights them white up to the pointer, a click saves that many (the
// same again removes it) through onRate(value | null).
export function gameRating(row, rank, { onRate } = {}) {
  if (!row) return null;
  const mine = Number(row.my_rating) || 0;
  const igdb = Number(row.rating) > 0 ? Number(row.rating) : 0;
  const igdbCount = igdb ? Math.max(Number(row.rating_count) || 0, 1) : 0;
  const count = igdbCount + (mine ? 1 : 0);
  // Mine is 1-5 stars, which is 20-100 on IGDB's scale.
  const score = count ? (igdb * igdbCount + mine * 20) / count / 20 : 0;
  const shown = Math.round(score * 10) / 10;

  const line = document.createElement("div");
  line.className = "game-rating";
  const part = document.createElement("span");
  part.className = "game-rating-score";
  const stars = document.createElement("span");
  stars.className = "game-stars";
  stars.classList.toggle("is-mine", !!mine);
  const fill = document.createElement("span");
  fill.className = "game-stars-fill";
  fill.textContent = "★★★★★";
  fill.style.width = `${(shown / 5) * 100}%`;
  const lit = document.createElement("span");
  lit.className = "game-stars-lit";
  lit.textContent = "★★★★★";
  stars.append("★★★★★", fill, lit);
  if (onRate) {
    for (let n = 1; n <= 5; n++) {
      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "game-star-hit";
      hit.style.left = `${(n - 1) * 20}%`;
      hit.setAttribute("aria-label", `Rate ${n} out of 5`);
      hit.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") lit.style.width = `${n * 20}%`;
      });
      hit.addEventListener("click", () => onRate(n === mine ? null : n));
      stars.append(hit);
    }
    stars.addEventListener("pointerleave", () => {
      lit.style.width = "0";
    });
  }
  part.append(stars);
  if (count) {
    const num = document.createElement("span");
    num.textContent = shown.toFixed(1);
    part.append(num);
    const tip = document.createElement("span");
    tip.className = "game-tip";
    tip.setAttribute("aria-hidden", "true");
    const votes = `${count.toLocaleString("en-US")} ${count === 1 ? "vote" : "votes"}`;
    for (const text of mine ? [votes, `Your vote: ${mine}`] : [votes]) {
      const row = document.createElement("span");
      row.className = "game-tip-line";
      row.textContent = text;
      tip.append(row);
    }
    part.append(tip);
    wireTaps(line, ".game-rating-score");
  }
  part.setAttribute(
    "aria-label",
    count ? `Rating ${shown} out of 5, ${count} votes` : "No votes yet",
  );
  line.append(part);

  if (rank) {
    const divider = document.createElement("span");
    divider.className = "game-rating-divider";
    divider.setAttribute("aria-hidden", "true");
    const trend = document.createElement("span");
    trend.textContent = `Trending #${rank}`;
    line.append(divider, trend);
  }
  return line;
}

export function gameName(row) {
  if (!row?.name) return null;
  const name = document.createElement("h1");
  name.className = "game-name";
  name.textContent = row.name;
  return name;
}

// The name over type · date, for the top bar between Back and the menu pill
// (laid out like the Customize header).
export function gameHeading(row) {
  if (!row?.name) return null;
  const block = document.createElement("div");
  block.className = "game-heading";
  const title = document.createElement("h2");
  title.className = "game-title";
  title.textContent = row.name;
  block.append(title);
  const meta = metaText(row);
  if (meta) {
    const line = document.createElement("p");
    line.className = "game-meta";
    line.textContent = meta;
    block.append(line);
  }
  return block;
}

function svgEl(icon) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", icon.viewBox);
  const [, , w, h] = icon.viewBox.split(" ").map(Number);
  svg.style.aspectRatio = `${w} / ${h}`;
  if (icon.scale) svg.style.setProperty("--icon-scale", icon.scale);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  if (icon.stroke) {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", icon.stroke);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  } else path.setAttribute("fill", "currentColor");
  if (icon.fillRule) path.setAttribute("fill-rule", icon.fillRule);
  path.setAttribute("d", icon.d);
  svg.append(path);
  return svg;
}

// `title` is a line or a list of lines; a line is text or a console
// ({ label, icon }) shown as its wordmark.
function markEl({ key, icon, title, owned }) {
  const mark = document.createElement("span");
  mark.className = "game-platform";
  mark.dataset.family = key;
  mark.classList.toggle("is-owned", owned);
  mark.append(svgEl(icon));
  // The tooltip under the mark (css shows it on hover, or .is-tip on a tap).
  const tip = document.createElement("span");
  tip.className = "game-tip";
  tip.setAttribute("aria-hidden", "true");
  // One line per console or store when the mark stands for several.
  const lines = [title].flat();
  for (const line of lines) {
    const row = document.createElement("span");
    row.className = "game-tip-line";
    if (line.icon) row.append(svgEl(line.icon));
    else row.textContent = line;
    tip.append(row);
  }
  mark.append(tip);
  mark.setAttribute("aria-label", lines.map((l) => l.label ?? l).join(", "));
  mark.setAttribute("role", "img");
  return mark;
}

// A tap (touch or pen) on a mark shows its tooltip until the next tap
// anywhere; a mouse uses hover instead.
function wireTaps(list, hostSelector = ".game-platform") {
  const close = (event) => {
    if (event && list.contains(event.target)) return;
    for (const m of list.querySelectorAll(".is-tip")) {
      m.classList.remove("is-tip");
    }
    document.removeEventListener("pointerdown", close, true);
  };
  list.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse" || event.target.closest(".game-star-hit"))
      return;
    const mark = event.target.closest(hostSelector);
    const open = mark && !mark.classList.contains("is-tip");
    close();
    if (!open) return;
    mark.classList.add("is-tip");
    document.addEventListener("pointerdown", close, true);
  });
}

// The family's consoles the owner has a copy on.
function ownedConsoles(family) {
  return (family.consoles ?? []).filter((k) =>
    family.owned.some((c) => c.version && c.version === k.version),
  );
}

// The game's summary (its storyline when there is none), cut to three lines
// with an ellipsis and a "Read more" button right after it. The cut is found by
// measuring, so the button sits on the last line whatever the width. Opening
// and closing animate the height so what follows is pushed or pulled along.
export function gameDescription(row, { onSettle } = {}) {
  const raw = row?.summary?.trim() || row?.storyline?.trim() || "";
  // Blank lines between paragraphs are dropped; the line breaks stay.
  const full = raw.replace(/\s*\n\s*/g, "\n");
  if (!full) return null;
  const box = document.createElement("div");
  box.className = "game-desc";
  const text = document.createElement("p");
  text.className = "game-desc-text";
  text.textContent = full;
  box.append(text);
  const more = document.createElement("button");
  more.type = "button";
  more.className = "game-desc-more";

  let expanded = false;
  let busy = false;
  let width = 0;
  let collapsedH = 0;
  const reduce = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showCollapsed() {
    text.textContent = full;
    const max = (parseFloat(getComputedStyle(text).lineHeight) || 20) * 3 + 1;
    if (text.scrollHeight <= max) {
      collapsedH = text.offsetHeight;
      return;
    }
    more.textContent = "Read more";
    const cut = (n) => {
      text.textContent = `${full.slice(0, n).trimEnd()}… `;
      text.append(more);
      return text.scrollHeight <= max;
    };
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cut(mid)) lo = mid;
      else hi = mid - 1;
    }
    // Back to a whole word, unless that loses too much.
    const space = full.lastIndexOf(" ", lo);
    cut(space > lo * 0.6 ? space : lo);
    collapsedH = text.offsetHeight;
  }

  function showExpanded() {
    text.textContent = `${full} `;
    more.textContent = "Show less";
    text.append(more);
  }

  // Height animation; `done` runs once it ends.
  function glide(to, done) {
    busy = true;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      box.removeEventListener("transitionend", onEnd);
      box.style.height = "";
      done?.();
      busy = false;
      onSettle?.();
    };
    const onEnd = (e) => e.target === box && end();
    box.addEventListener("transitionend", onEnd);
    box.getBoundingClientRect();
    box.style.height = `${to}px`;
    setTimeout(end, 500);
  }

  more.addEventListener("click", () => {
    if (busy) return;
    const from = box.offsetHeight;
    if (reduce()) {
      expanded = !expanded;
      if (expanded) showExpanded();
      else showCollapsed();
      onSettle?.();
      return;
    }
    box.style.height = `${from}px`;
    if (!expanded) {
      expanded = true;
      showExpanded();
      glide(text.offsetHeight);
    } else {
      expanded = false;
      glide(collapsedH, showCollapsed);
    }
  });

  // Fits the text once it is on screen, and again if the width changes. A
  // hidden sheet has no width, so it waits.
  new ResizeObserver(() => {
    const w = box.clientWidth;
    if (!w || w === width || expanded || busy) return;
    width = w;
    showCollapsed();
  }).observe(box);
  return box;
}

// The platform marks, for under the logo. `copies` are the owner's library
// copies of the game ({ platform, version }); owned marks show in white.
export function gameInfoLine(row, copies = []) {
  const marks = families(row?.platforms, copies);
  if (!marks.length) return null;
  const list = document.createElement("div");
  list.className = "game-info";
  const label = document.createElement("span");
  label.className = "game-info-label";
  label.textContent = "Available for";
  list.append(label);
  wireTaps(list);
  for (const family of [...marks].sort(
    (a, b) => (b.owned.length > 0) - (a.owned.length > 0),
  )) {
    // Consoles with a wordmark show it in the tooltip; others their name.
    const consoles = family.consoles ?? [];
    const names = [
      ...family.platforms,
      ...ownedConsoles(family).filter(
        (k) => !family.platforms.some((p) => p.id === k.id),
      ),
    ]
      .sort((a, b) => age(a.id) - age(b.id))
      .map((p) => consoles.find((k) => k.id === p.id) ?? p.name ?? p.label);
    const title =
      family.key === "pc" || family.key === "browser"
        ? family.label
        : names.length
          ? names
          : family.label;
    const owned = family.owned.length > 0;
    const stores =
      family.key === "pc"
        ? STORES.filter((s) =>
            family.owned.some((c) => c.version === s.version),
          )
        : [];
    if (stores.length) {
      for (const store of stores) {
        list.append(
          markEl({
            key: family.key,
            icon: store.icon,
            title: store.label,
            owned,
          }),
        );
      }
      continue;
    }
    list.append(
      markEl({
        key: family.key,
        icon: family.icon,
        title,
        owned,
      }),
    );
  }
  return list;
}
