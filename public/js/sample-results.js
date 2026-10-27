// TEMPORARY placeholder data for the result-card draft. Delete this file (and
// its import in results-page.js) when real search results plug in.
//
// Shape of one result: { title, year, type, category } - `type` is the label,
// `category` the IGDB number (see result-types.js) the filter works on.

import { TYPES } from "/js/result-types.js";

const longTitle = "Game Title That Is Much Too Long To Fit Under One Cover";
// Mostly main games, with a spread of the rest so filtering is visible.
const SPREAD = [0, 0, 0, 1, 0, 0, 3, 0, 8, 0, 9, 0, 0, 2, 0, 4, 0, 0, 10, 0];

const SAMPLE_RESULTS = Array.from({ length: 60 }, (_, i) => {
  const category = SPREAD[i % SPREAD.length];
  return {
    title: i % 17 === 5 ? longTitle : "Game Title",
    year: 2024,
    type: TYPES.find((t) => t.value === category).label,
    category,
  };
});

// TEMPORARY fake paged load so the skeleton and load-on-scroll behaviour can
// be seen. Resolves { items, hasMore } for the slice after a fake delay (first
// batch slower), plus `counts` (type -> how many in the whole set). It ignores
// the filter ({ types }); real search applies it in its request and replaces
// this with its own.
const COUNTS = Object.fromEntries(TYPES.map((t) => [t.value, 0]));
for (const r of SAMPLE_RESULTS) COUNTS[r.category]++;

export function loadSampleResults(offset, limit) {
  const delay = offset === 0 ? 1500 : 800;
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          items: SAMPLE_RESULTS.slice(offset, offset + limit),
          hasMore: offset + limit < SAMPLE_RESULTS.length,
          counts: COUNTS,
        }),
      delay,
    ),
  );
}
