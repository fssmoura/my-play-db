/**
 * Linking owned games (player_games rows) to IGDB. Platform-agnostic: each
 * platform supplies a small adapter (see _match-steam.js) and this file does
 * the rest.
 *
 * THE FLOW, per unlinked row
 *
 *   1. Skip rows on the ignore list, and rows already waiting for review
 *      (unless `retry`).
 *   2. Exact: IGDB's own store-id table (external_games). Batched, one call.
 *   3. Otherwise fetch the platform's store details for the row.
 *   4. Search IGDB by that name - plainly, and again limited to games released
 *      within a week of the store's date - then pull full records for the
 *      closest few.
 *   5. Exact again: a candidate whose store links include this row's id.
 *   6. Otherwise score name, release date, companies and website, and link
 *      only a single clear winner.
 *   7. Anything else is left unlinked with `meta.review` holding the likely
 *      options, for the owner to pick.
 *
 * A link is written once and never re-resolved. Linking caches the IGDB record
 * (cache_game_details), sets igdb_id, and drops `name` and `review` from meta.
 *
 * ADAPTER CONTRACT
 *
 *   key            ignored_games.platform value, and the `platform` option
 *   rowFilter      PostgREST filter selecting this platform's rows
 *   externalId(r)  the store id of a player_games row, as a string
 *   igdbSource     IGDB external_games source name, or null if IGDB has none
 *   details(ids)   Map id -> { name, date (ms|null), developers, publishers,
 *                  website } from the store, for fallback rows only
 *   storeLinked(game, id)  true when an IGDB record names this store id
 */

const { toDetailRow } = require("./_igdb-cache");

/* ------------------------------------------------------------ name scoring --
 * Copied from public/js/sgdb-match.js (nameSimilarity and its helpers), where
 * it was measured against real SteamGridDB data. The two copies are
 * independent. The rule carries over: a near neighbour (sequel, edition, DLC)
 * must not pass as the same game.
 */

const ROMAN = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16,
  xvii: 17,
  xviii: 18,
  xix: 19,
  xx: 20,
};

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "for"]);

const QUALIFIERS = new Set([
  "edition",
  "version",
  "remastered",
  "remaster",
  "remake",
  "definitive",
  "anniversary",
  "enhanced",
  "complete",
  "ultimate",
  "deluxe",
  "goty",
  "collection",
  "trilogy",
  "bundle",
  "pack",
  "dlc",
  "expansion",
  "season",
  "episode",
  "demo",
  "beta",
  "trial",
  "classic",
  "redux",
  "reloaded",
  "hd",
  "vr",
  "console",
  "mobile",
  "portable",
  "arcade",
  "online",
  "switch",
  "wii",
  "xbox",
  "playstation",
  "ps4",
  "ps5",
  "pc",
  "steam",
]);

function normalize(value) {
  return String(value ?? "")
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value) {
  const norm = normalize(value);
  if (!norm) return [];
  const words = norm.split(" ").filter((w) => w && !STOPWORDS.has(w));
  return words.length ? words : norm.split(" ").filter(Boolean);
}

function arabicize(tokens) {
  if (tokens.length < 2) return tokens;
  return tokens.map((t) => (ROMAN[t] ? String(ROMAN[t]) : t));
}

function ordinals(tokens) {
  return new Set(tokens.filter((t) => /^\d+$/.test(t)));
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function bigrams(value) {
  const flat = normalize(value).replace(/ /g, "");
  const out = new Set();
  for (let i = 0; i < flat.length - 1; i += 1) out.add(flat.slice(i, i + 2));
  return out;
}

function symmetricDifference(a, b) {
  const out = [];
  for (const t of a) if (!b.has(t)) out.push(t);
  for (const t of b) if (!a.has(t)) out.push(t);
  return out;
}

function isStrictSubset(a, b) {
  if (a.size === b.size) return false;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** 0-1. `strict: false` skips the sequel/edition/subset penalties. */
function nameSimilarity(a, b, { strict = true } = {}) {
  const ta = arabicize(tokenize(a));
  const tb = arabicize(tokenize(b));
  if (!ta.length || !tb.length) return 0;

  const sa = new Set(ta);
  const sb = new Set(tb);
  if (sa.size === sb.size && dice(sa, sb) === 1) return 1;

  let score = Math.max(dice(sa, sb), dice(bigrams(a), bigrams(b)));
  if (!strict) return score;

  const oa = ordinals(ta);
  const ob = ordinals(tb);
  if (dice(oa, ob) !== 1 && (oa.size || ob.size)) score *= 0.55;

  if (
    isStrictSubset(sa, sb) ||
    symmetricDifference(sa, sb).some((t) => QUALIFIERS.has(t))
  ) {
    score *= 0.5;
  }
  return score;
}

/* --------------------------------------------------------- other evidence -- */

const NAME_FLOOR = 0.8;
const STRONG_NAME = 0.97;
const YEAR_LIMIT = 5;
const SAME_RELEASE_DAYS = 7;
const CLEAR_MARGIN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// IGDB game_type values that are never a store's own app: DLC, expansion,
// bundle, pack, update. Not mods: some are sold as games (Penumbra: Necrologue).
const NOT_AN_APP = [1, 2, 3, 13, 14];
const PORT = 11;

/**
 * What to type into IGDB's search for one store name: the name as written
 * (cleaning it up loses apostrophes IGDB needs), without a brand in front of
 * a trademark sign ("EA SPORTS™ FIFA 21"), and without a store subtitle
 * ("Business Tour - Board Game with Online Multiplayer").
 */
function searchForms(name) {
  const plain = String(name)
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const forms = [plain];
  const branded = /^[^\u2122\u00ae]{2,30}[\u2122\u00ae]\s*(.{3,})$/.exec(name);
  if (branded)
    forms.push(branded[1].replace(/[\u2122\u00ae\u00a9]/g, "").trim());
  for (const f of [...forms]) {
    const sub = /^(.{3,}?)\s+[-\u2013\u2014]\s+.{3,}$/.exec(f);
    if (sub) forms.push(sub[1].trim());
  }
  return [...new Set(forms.filter(Boolean))];
}

const COMPANY_NOISE =
  /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|sa|srl|ab|as|bv|kk|plc|pty|studios?|games|entertainment|interactive|software|digital|publishing)\b/g;

function companyKey(value) {
  return normalize(value)
    .replace(COMPANY_NOISE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function companiesAgree(store, game) {
  const ours = [...(store.developers ?? []), ...(store.publishers ?? [])]
    .map(companyKey)
    .filter((k) => k.length >= 3);
  const theirs = (game.involved_companies ?? [])
    .map((c) => companyKey(c?.company?.name))
    .filter((k) => k.length >= 3);
  return ours.some((a) =>
    theirs.some(
      (b) => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `),
    ),
  );
}

function domain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host.split(".").slice(-2).join(".");
  } catch {
    return null;
  }
}

const NOT_OFFICIAL = new Set([
  "steampowered.com",
  "steamcommunity.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "instagram.com",
  "discord.gg",
  "discord.com",
  "reddit.com",
  "twitch.tv",
  "wikipedia.org",
  "fandom.com",
  "epicgames.com",
  "gog.com",
  "playstation.com",
  "xbox.com",
  "nintendo.com",
]);

function websitesAgree(store, game) {
  const ours = domain(store.website);
  if (!ours || NOT_OFFICIAL.has(ours)) return false;
  return (game.websites ?? []).some((w) => domain(w?.url) === ours);
}

/** Smallest gap, in days, between the store date and any IGDB date. */
function dayGap(store, game) {
  if (!store.date) return null;
  const dates = [
    game.first_release_date,
    ...(game.release_dates ?? []).map((r) => r?.date),
  ].filter((s) => typeof s === "number" && s > 0);
  if (!dates.length) return null;
  return Math.min(
    ...dates.map((s) => Math.abs(s * 1000 - store.date) / DAY_MS),
  );
}

function dateScore(days) {
  if (days == null) return 5;
  if (days <= SAME_RELEASE_DAYS) return 20;
  if (days <= 366) return 12;
  if (days <= 366 * 2) return 6;
  return 0;
}

function yearOf(game) {
  return game.first_release_date
    ? new Date(game.first_release_date * 1000).getUTCFullYear()
    : null;
}

/** Everything known about one candidate against the store's details. */
function scoreCandidate(store, names, game) {
  const titles = [
    game.name,
    ...(game.alternative_names ?? []).map((a) => a?.name),
  ].filter(Boolean);
  let name = 0;
  for (const ours of names) {
    for (const theirs of titles) {
      name = Math.max(name, nameSimilarity(ours, theirs));
    }
  }

  const days = dayGap(store, game);
  const sameRelease = days != null && days <= SAME_RELEASE_DAYS;
  const company = companiesAgree(store, game);
  const website = websitesAgree(store, game);

  // A strong name passes on its own unless the year is far off. A weak name
  // (a store calling a game by its series, e.g. "Call of Duty") passes only on
  // all three independent signals at once.
  const yearsOff = days == null ? null : days / 365.25;
  const eligible =
    (name >= NAME_FLOOR && (yearsOff == null || yearsOff <= YEAR_LIMIT)) ||
    (sameRelease && company && website);

  const support =
    (days != null && days <= 366 ? 1 : 0) +
    (company ? 1 : 0) +
    (website ? 1 : 0);

  return {
    game,
    name,
    days,
    company,
    website,
    eligible,
    support,
    total:
      name * 100 + dateScore(days) + (company ? 10 : 0) + (website ? 10 : 0),
  };
}

function summary(scored) {
  return {
    igdb_id: scored.game.id,
    name: scored.game.name,
    year: yearOf(scored.game),
  };
}

function refId(value) {
  return value && typeof value === "object" ? value.id : (value ?? null);
}

/**
 * The verdict for one fallback row: { link: game, how } or { review }.
 * Auto-links only when one candidate is clearly ahead and backed by more than
 * its name alone (or its name is a near-exact match).
 */
function decide(store, names, candidates, externalId, adapter) {
  for (const game of candidates) {
    if (adapter.storeLinked(game, externalId)) {
      return { link: game, how: "store_link" };
    }
  }

  const scored = candidates
    .map((game) => scoreCandidate(store, names, game))
    .sort((a, b) => b.total - a.total);
  // An edition or port competing with its own original is the same game
  // twice; keep the original.
  const eligibleIds = new Set(
    scored.filter((s) => s.eligible).map((s) => s.game.id),
  );
  const eligible = scored.filter(
    (s) =>
      s.eligible &&
      !eligibleIds.has(refId(s.game.version_parent)) &&
      !(
        s.game.game_type === PORT && eligibleIds.has(refId(s.game.parent_game))
      ),
  );
  const best = eligible[0];
  const runnerUp = eligible[1];

  if (best) {
    const clear = !runnerUp || best.total - runnerUp.total >= CLEAR_MARGIN;
    const backed = best.support >= 1 || best.name >= STRONG_NAME;
    if (clear && backed) {
      return {
        link: best.game,
        how: best.name >= NAME_FLOOR ? "name" : "release",
      };
    }
  }

  const shortlist = (eligible.length ? eligible : scored).slice(0, 3);
  return {
    review: {
      reason: !best
        ? "no IGDB game looked like this one"
        : runnerUp && best.total - runnerUp.total < CLEAR_MARGIN
          ? "more than one IGDB game fits"
          : "only weak evidence",
      candidates: shortlist.map(summary),
    },
  };
}

/* ------------------------------------------------------------------ runner -- */

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Matches a platform's unlinked rows. `db` is a small Supabase REST client
 * (see serviceClient) and `igdb` the IGDB actions, passed in so they can be
 * swapped.
 *
 * options: limit (rows per run), only (store ids to restrict to), retry
 * (re-run rows already in review), dry_run (decide but write nothing).
 */
async function runMatch({ adapter, db, igdb, options = {} }) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 100;
  const only = options.only
    ? new Set(
        (Array.isArray(options.only) ? options.only : [options.only]).map(
          String,
        ),
      )
    : null;
  const dryRun = Boolean(options.dry_run);

  const [rows, ignoredRows] = await Promise.all([
    db.select(
      "player_games",
      `${adapter.rowFilter}&igdb_id=is.null&select=id,meta&order=id`,
    ),
    db.select("ignored_games", `platform=eq.${adapter.key}&select=external_id`),
  ]);
  const ignored = new Set(ignoredRows.map((r) => String(r.external_id)));

  const report = {
    platform: adapter.key,
    dry_run: dryRun,
    linked: [],
    review: [],
    skipped: { ignored: 0, in_review: 0 },
    failed: [],
    remaining: 0,
  };

  const queue = [];
  for (const row of rows) {
    const id = adapter.externalId(row);
    if (!id || (only && !only.has(id))) continue;
    if (ignored.has(id)) {
      report.skipped.ignored += 1;
      continue;
    }
    if (row.meta?.review && !options.retry) {
      report.skipped.in_review += 1;
      continue;
    }
    queue.push({ row, id });
  }
  const batch = queue.slice(0, limit);
  report.remaining = queue.length - batch.length;
  if (!batch.length) return report;

  /* Step 2 - exact, by store id. */
  const decisions = new Map();
  if (adapter.igdbSource) {
    const hits = await igdb.byExternalMany(
      adapter.igdbSource,
      batch.map((b) => b.id),
    );
    for (const { id } of batch) {
      const games = hits[id] ?? [];
      if (games.length === 1)
        decisions.set(id, { linkId: games[0], how: "store_id" });
      else if (games.length > 1) {
        decisions.set(id, {
          review: {
            reason: "IGDB lists this store id on more than one game",
            candidates: games.map((g) => ({
              igdb_id: g,
              name: null,
              year: null,
            })),
          },
        });
      }
    }
  }

  /* Steps 3-6 - fallback for the misses. */
  const misses = batch.filter((b) => !decisions.has(b.id));
  if (misses.length) {
    const details = await adapter.details(misses.map((m) => m.id));
    for (const { row, id } of misses) {
      try {
        const store = details.get(id) ?? {};
        const original = [
          ...new Set([store.name, row.meta?.name].filter(Boolean)),
        ];
        if (!original.length) {
          decisions.set(id, {
            review: { reason: "no name to search with", candidates: [] },
          });
          continue;
        }
        const queries = [...new Set(original.flatMap(searchForms))];
        const names = [...new Set([...original, ...queries])];
        const found = new Map();
        const consider = (results) => {
          for (const g of results) {
            if (NOT_AN_APP.includes(g.game_type)) continue;
            const loose = Math.max(
              ...names.map((n) => nameSimilarity(n, g.name, { strict: false })),
            );
            const prev = found.get(g.id);
            if (!prev || prev.loose < loose)
              found.set(g.id, { id: g.id, loose });
          }
        };
        const windowed = [];
        for (const query of queries) {
          consider(await igdb.search({ query, limit: 30 }));
          if (store.date && igdb.searchReleasedBetween) {
            const around = SAME_RELEASE_DAYS * DAY_MS;
            const hits = await igdb.searchReleasedBetween(
              query,
              (store.date - around) / 1000,
              (store.date + around) / 1000,
            );
            windowed.push(
              ...hits
                .filter((g) => !NOT_AN_APP.includes(g.game_type))
                .map((g) => g.id),
            );
            consider(hits);
          }
        }
        if (!found.size && igdb.byExactName) {
          for (const query of queries) consider(await igdb.byExactName(query));
        }
        // Released the same week as the store says: always worth a full look,
        // however different the name.
        const closest = [
          ...new Set([
            ...windowed.slice(0, 5),
            ...[...found.values()]
              .sort((a, b) => b.loose - a.loose)
              .map((c) => c.id),
          ]),
        ].slice(0, 12);
        const candidates = closest.length
          ? await igdb.game({ ids: closest })
          : [];
        const verdict = decide(store, names, candidates, id, adapter);
        decisions.set(
          id,
          verdict.link
            ? { linkId: verdict.link.id, game: verdict.link, how: verdict.how }
            : verdict,
        );
      } catch (err) {
        report.failed.push({
          row_id: row.id,
          external_id: id,
          error: err.message,
        });
      }
    }
  }

  /* An IGDB game can back only one row per platform version. */
  const linkIds = [
    ...new Set(
      [...decisions.values()].filter((d) => d.linkId).map((d) => d.linkId),
    ),
  ];
  const taken = new Map();
  if (linkIds.length) {
    const existing = await db.select(
      "player_games",
      `${adapter.rowFilter}&igdb_id=in.(${linkIds.join(",")})&select=id,igdb_id`,
    );
    for (const r of existing) taken.set(r.igdb_id, r.id);
  }

  /* Full IGDB records for everything about to be linked, in one go. */
  const needed = linkIds.filter(
    (gid) => ![...decisions.values()].some((d) => d.linkId === gid && d.game),
  );
  const records = new Map();
  for (const ids of chunk(needed, 50)) {
    for (const g of await igdb.game({ ids })) records.set(g.id, g);
  }
  for (const d of decisions.values())
    if (d.game) records.set(d.game.id, d.game);

  /* Step 7 - write. */
  for (const { row, id } of batch) {
    const d = decisions.get(id);
    if (!d) continue;
    const label = row.meta?.name ?? id;

    if (d.linkId && taken.has(d.linkId)) {
      d.review = {
        reason:
          "that IGDB game is already linked to another of this platform's games",
        candidates: [
          {
            igdb_id: d.linkId,
            name: records.get(d.linkId)?.name ?? null,
            year: null,
          },
        ],
      };
      delete d.linkId;
    }

    try {
      if (d.linkId) {
        const game = records.get(d.linkId);
        if (!game) throw new Error(`IGDB returned no record for ${d.linkId}`);
        if (!dryRun) {
          const payload = toDetailRow(game);
          if (!payload)
            throw new Error(`IGDB record ${d.linkId} has no name or slug`);
          await db.rpc("cache_game_details", { payload });
          const meta = { ...row.meta };
          delete meta.name;
          delete meta.review;
          if (d.how !== "store_id") meta.matched_by = d.how;
          await db.update("player_games", `id=eq.${row.id}`, {
            igdb_id: d.linkId,
            meta,
            synced_at: new Date().toISOString(),
          });
        }
        taken.set(d.linkId, row.id);
        report.linked.push({
          row_id: row.id,
          name: label,
          igdb_id: d.linkId,
          igdb_name: game.name,
          how: d.how,
        });
      } else if (d.review) {
        if (!dryRun) {
          await db.update("player_games", `id=eq.${row.id}`, {
            meta: { ...row.meta, review: d.review },
          });
        }
        report.review.push({ row_id: row.id, name: label, ...d.review });
      }
    } catch (err) {
      report.failed.push({
        row_id: row.id,
        external_id: id,
        error: err.message,
      });
    }
  }

  return report;
}

/* ------------------------------------------------------------ entry point --
 * Server-side only (scheduled jobs, or a one-off node run): uses the service
 * role key, which bypasses row level security.
 */

const ADAPTERS = {
  steam: () => require("./_match-steam"),
};

function serviceClient() {
  const base = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function send(url, init) {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...init.headers },
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    select: (table, query) =>
      send(`${base}/${table}?${query}`, { method: "GET" }),
    update: (table, filter, body) =>
      send(`${base}/${table}?${filter}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(body),
      }),
    updateReturning: (table, filter, body) =>
      send(`${base}/${table}?${filter}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      }),
    insert: (table, rows) =>
      send(`${base}/${table}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows),
      }),
    upsert: (table, onConflict, rows) =>
      send(`${base}/${table}?on_conflict=${onConflict}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      }),
    rpc: (fn, body) =>
      send(`${base}/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) }),
  };
}

/** Matches one platform's unlinked games. options as for runMatch. */
async function matchPlatform(platform, options = {}) {
  if (!ADAPTERS[platform]) {
    throw new Error(
      `platform must be one of: ${Object.keys(ADAPTERS).join(", ")}`,
    );
  }
  const igdb = require("./igdb");
  return runMatch({
    adapter: ADAPTERS[platform](),
    db: serviceClient(),
    igdb: {
      ...igdb.actions,
      byExternalMany: igdb.byExternalMany,
      searchReleasedBetween: igdb.searchReleasedBetween,
      byExactName: igdb.byExactName,
    },
    options,
  });
}

module.exports = { matchPlatform, runMatch, nameSimilarity, serviceClient };
