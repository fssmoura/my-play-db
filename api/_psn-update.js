// The PlayStation updater. Server-side only (service role). Called by
// api/library-sync.js; safe to run as often as wanted. See
// docs/database.md#the-playstation-updater.

const { actions } = require("./psn");
const { matchPlatform } = require("./_match");
const { loadPsnTrophies } = require("./_psn-achievements");

// Purchases (new games, PS Plus games that left) are checked at most this often.
const PURCHASE_GAP_MS = 20 * 60 * 60 * 1000;
// More PS Plus games than this leaving at once looks like a Sony glitch.
const MAX_REMOVALS = 60;

const CATALOGUE =
  "https://m.np.playstation.com/api/catalog/v2/titles/{code}/concepts?age=99&country=GB&language=en-GB";

const versionOf = (code) =>
  code.startsWith("PPSA") ? "ps5" : code.startsWith("CUSA") ? "ps4" : null;

/** "PT31H29M18S" -> seconds. Hours are never rolled into days. */
function seconds(duration) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?/.exec(
    duration ?? "",
  );
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

const later = (a, b) =>
  !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;
const earlier = (a, b) =>
  !a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b;

/** Sony's concept and English name for one code (public catalogue). */
async function conceptOf(code) {
  try {
    const res = await fetch(CATALOGUE.replace("{code}", code));
    if (!res.ok) return null;
    const list = await res.json();
    const c = Array.isArray(list) ? list[0] : list;
    return c?.id ? { id: c.id, name: c.nameEn || c.name || null } : null;
  } catch {
    return null;
  }
}

/**
 * options: { db, accessToken, deadline (ms epoch), log(message) }
 * Returns the same summary shape as the Steam updater, plus `checked`
 * ("quick" when the recently-played list showed nothing new) and `removed`.
 *
 * Every run first reads the recently-played list (one call). Nothing newer
 * than what is stored, and purchases checked within the last 20 hours: done.
 * Otherwise play history updates the played rows (adding new games), and
 * purchases, at most daily, add newly bought or claimed games and remove
 * unplayed PS Plus games no longer offered. Trophies are re-read for every
 * row that changed. A row's play data is saved only after its trophies, so a
 * failure still looks changed next run and is retried. Played games are
 * never removed.
 */
async function updatePsn({
  db,
  accessToken,
  deadline = Infinity,
  log = () => {},
}) {
  const authorization = { accessToken };
  const report = {
    checked: "full",
    new_games: [],
    updated: 0,
    new_unlocks: 0,
    full_loads: 0,
    removed: [],
    match: null,
    failed: [],
    unfinished: 0,
  };

  const [rows, ignoredRows, [syncRow]] = await Promise.all([
    db.select(
      "player_games",
      "platform=eq.playstation&select=id,version,igdb_id,playtime,play_count,first_played,last_played,meta,achievements(count)",
    ),
    db.select("ignored_games", "platform=eq.playstation&select=external_id"),
    db.select("library_sync", "platform=eq.playstation&select=state"),
  ]);
  const ignored = new Set(ignoredRows.map((r) => String(r.external_id)));
  const state = syncRow?.state ?? {};
  const purchasesDue =
    !state.purchases_checked_at ||
    Date.now() - Date.parse(state.purchases_checked_at) > PURCHASE_GAP_MS;

  const rowByCode = new Map();
  for (const r of rows)
    for (const c of r.meta?.title_ids ?? []) rowByCode.set(c, r);
  const hasTrophies = (r) => (r.achievements?.[0]?.count ?? 0) > 0;
  // Played or bought rows with a known list but no trophies stored yet
  // (a load that failed, or a game just bought).
  const missingTrophies = () =>
    rows.filter(
      (r) =>
        r.meta?.trophy_sets?.length &&
        (r.playtime != null || r.meta?.ps_plus === false) &&
        !hasTrophies(r),
    );

  /* Quick check. */
  log("Checking PlayStation...");
  const recent = (await actions.recent(authorization, { limit: 50 })).games;
  const moved = recent.filter((g) => {
    if (ignored.has(g.titleId) || !versionOf(g.titleId)) return false;
    const row = rowByCode.get(g.titleId);
    return (
      !row ||
      !row.last_played ||
      Date.parse(g.lastPlayedDateTime) > Date.parse(row.last_played)
    );
  });
  if (!moved.length && !purchasesDue && !missingTrophies().length) {
    report.checked = "quick";
    return report;
  }

  const changed = new Map(); // row id -> pending play fields
  const trophyMap = async (codes) => {
    if (!codes.length) return {};
    return (await actions.trophymap(authorization, { titleIds: codes }))
      .resolved;
  };
  const setsFor = (resolved, codes) => {
    const seen = new Set();
    const sets = [];
    for (const c of codes)
      for (const s of resolved[c]?.sets ?? [])
        if (!seen.has(s.npCommunicationId)) {
          seen.add(s.npCommunicationId);
          sets.push({ id: s.npCommunicationId, service: s.npServiceName });
        }
    return sets;
  };
  const insert = async (row) => {
    const [saved] = await db.insert("player_games", [row]);
    saved.achievements = [{ count: 0 }];
    rows.push(saved);
    for (const c of saved.meta.title_ids) rowByCode.set(c, saved);
    report.new_games.push(saved.meta.name);
    return saved;
  };

  /* Play history. */
  if (moved.length) {
    log("Reading play history...");
    const played = (await actions.games(authorization)).titles.filter(
      (t) => !ignored.has(t.titleId) && versionOf(t.titleId),
    );
    // Every played code of one row, or of one new game on one console.
    const groups = new Map();
    for (const t of played) {
      const version = versionOf(t.titleId);
      const concept = t.concept?.id ?? null;
      const row =
        rowByCode.get(t.titleId) ??
        rows.find(
          (r) =>
            r.version === version &&
            concept != null &&
            String(r.meta?.concept_id) === String(concept),
        );
      const key = row
        ? `row:${row.id}`
        : `new:${concept ?? t.titleId}|${version}`;
      const g = groups.get(key) ?? { row, version, concept, titles: [] };
      g.titles.push(t);
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      const play = {
        playtime: 0,
        play_count: 0,
        first_played: null,
        last_played: null,
      };
      for (const t of g.titles) {
        play.playtime += seconds(t.playDuration);
        play.play_count += t.playCount ?? 0;
        play.first_played = earlier(play.first_played, t.firstPlayedDateTime);
        play.last_played = later(play.last_played, t.lastPlayedDateTime);
      }
      const codes = g.titles.map((t) => t.titleId);

      if (g.row) {
        const r = g.row;
        const newer =
          !r.last_played ||
          Date.parse(play.last_played) > Date.parse(r.last_played) ||
          play.playtime > Number(r.playtime ?? 0);
        if (!newer) continue;
        const allCodes = [...new Set([...(r.meta.title_ids ?? []), ...codes])];
        let sets = r.meta.trophy_sets ?? [];
        if (!sets.length || allCodes.length > (r.meta.title_ids ?? []).length)
          sets = setsFor(await trophyMap(allCodes), allCodes);
        changed.set(r.id, {
          ...play,
          meta: { ...r.meta, title_ids: allCodes, trophy_sets: sets },
        });
        continue;
      }

      // A game first played on this console. An unplayed row of it on the
      // other console with nothing stored moves here; otherwise a new row.
      const sets = setsFor(await trophyMap(codes), codes);
      const other = rows.find(
        (r) =>
          g.concept != null &&
          String(r.meta?.concept_id) === String(g.concept) &&
          r.version !== g.version &&
          r.playtime == null &&
          !hasTrophies(r),
      );
      if (other) {
        await db.update("player_games", `id=eq.${other.id}`, {
          version: g.version,
          meta: { ...other.meta, title_ids: codes, trophy_sets: sets },
        });
        other.version = g.version;
        for (const c of other.meta.title_ids ?? []) rowByCode.delete(c);
        other.meta = { ...other.meta, title_ids: codes, trophy_sets: sets };
        for (const c of codes) rowByCode.set(c, other);
        changed.set(other.id, { ...play, meta: other.meta });
        continue;
      }
      const first = g.titles[0];
      const saved = await insert({
        platform: "playstation",
        version: g.version,
        meta: {
          title_ids: codes,
          ...(g.concept != null && { concept_id: g.concept }),
          trophy_sets: sets,
          ps_plus: g.titles.every((t) => t.service === "ps_plus"),
          name:
            (g.concept != null && (await conceptOf(first.titleId))?.name) ||
            first.name,
        },
        synced_at: new Date().toISOString(),
      });
      changed.set(saved.id, { ...play, meta: saved.meta });
    }
  }

  /* Purchases, at most daily. */
  if (purchasesDue) {
    log("Checking purchases...");
    const [owned, profile] = await Promise.all([
      actions.purchased(authorization, {}),
      actions.profile(authorization).catch(() => null),
    ]);
    const active = owned.games.filter(
      (p) => p.isActive && versionOf(p.titleId) && !ignored.has(p.titleId),
    );
    // A code's membership can change (a PS Plus game bought later), so an
    // entry is its code and membership.
    const entry = (p) => `${p.titleId}|${p.membership}`;
    const seen = new Set(state.purchase_entries ?? []);
    const firstCheck = !state.purchase_entries;
    const fresh = firstCheck
      ? []
      : active.filter(
          (p) =>
            !seen.has(entry(p)) &&
            (!rowByCode.has(p.titleId) || p.membership === "NONE"),
        );

    // New codes, grouped by game.
    const byConcept = new Map();
    for (const p of fresh) {
      const c = await conceptOf(p.titleId);
      const key = c ? String(c.id) : p.titleId;
      const e = byConcept.get(key) ?? { concept: c, items: [] };
      e.items.push(p);
      byConcept.set(key, e);
    }
    for (const { concept, items } of byConcept.values()) {
      const bought = items.some((p) => p.membership === "NONE");
      const existing = concept
        ? rows.filter((r) => String(r.meta?.concept_id) === String(concept.id))
        : [];
      if (existing.length) {
        // Another copy of a stored game: it can only make it bought.
        for (const r of existing)
          if (bought && r.meta?.ps_plus) {
            await db.update("player_games", `id=eq.${r.id}`, {
              meta: { ...r.meta, ps_plus: false },
            });
            r.meta = { ...r.meta, ps_plus: false };
          }
        continue;
      }
      const ps5 = items.filter((p) => versionOf(p.titleId) === "ps5");
      const pick = ps5.length ? ps5 : items;
      const codes = [...new Set(pick.map((p) => p.titleId))];
      await insert({
        platform: "playstation",
        version: versionOf(codes[0]),
        meta: {
          title_ids: codes,
          ...(concept && { concept_id: concept.id }),
          trophy_sets: setsFor(await trophyMap(codes), codes),
          ps_plus: !bought,
          name: concept?.name || pick[0].name,
        },
        synced_at: new Date().toISOString(),
      });
    }

    // Unplayed PS Plus games no longer offered - only while subscribed, so
    // a lapsed subscription keeps the list.
    const activeCodes = new Set(active.map((p) => p.titleId));
    const leaving = rows.filter(
      (r) =>
        r.meta?.ps_plus &&
        r.playtime == null &&
        !hasTrophies(r) &&
        (r.meta.title_ids ?? []).length &&
        !r.meta.title_ids.some((c) => activeCodes.has(c)),
    );
    if (leaving.length && profile?.profile?.isPlus === false) {
      report.removed_skipped = "PS Plus not active";
    } else if (leaving.length > MAX_REMOVALS || !active.length) {
      report.removed_skipped = `${leaving.length} would leave at once`;
    } else if (leaving.length) {
      await db.rpc("remove_unplayed_ps_plus", {
        row_ids: leaving.map((r) => r.id),
      });
      const gone = new Set(leaving.map((r) => r.id));
      const names = new Map(
        (
          await db.select(
            "games",
            `id=in.(${leaving.map((r) => r.igdb_id ?? 0).join(",")})&select=id,name`,
          )
        ).map((g) => [g.id, g.name]),
      );
      report.removed = leaving.map(
        (r) => r.meta.name ?? names.get(r.igdb_id) ?? r.meta.title_ids[0],
      );
      for (let i = rows.length - 1; i >= 0; i--)
        if (gone.has(rows[i].id)) rows.splice(i, 1);
    }

    await db.update("library_sync", "platform=eq.playstation", {
      state: {
        purchases_checked_at: new Date().toISOString(),
        purchase_entries: active.map(entry),
      },
    });
  }

  /* Matching. Its failure must not stop play data and trophies. */
  if (report.new_games.length) log("Matching new games...");
  let match = { linked: [], review: [], failed: [] };
  try {
    match = await matchPlatform("playstation");
    report.match = {
      linked: match.linked.length,
      review: match.review.length,
      failed: match.failed.length,
    };
  } catch (err) {
    report.match = { error: err.message };
  }
  // The matcher rewrote those rows' meta (dropping `name`); keep it.
  const touched = [...match.linked, ...match.review].map((m) => m.row_id);
  if (touched.length) {
    const after = await db.select(
      "player_games",
      `id=in.(${touched.join(",")})&select=id,igdb_id,meta`,
    );
    for (const a of after) {
      const r = rows.find((x) => x.id === a.id);
      if (r) Object.assign(r, { igdb_id: a.igdb_id, meta: a.meta });
      const pending = changed.get(a.id);
      if (pending) {
        const meta = { ...a.meta };
        meta.title_ids = pending.meta.title_ids;
        meta.trophy_sets = pending.meta.trophy_sets;
        pending.meta = meta;
      }
    }
  }

  /* Trophies, then play data. */
  const label = async (row) => {
    if (row.meta?.name) return row.meta.name;
    if (row.igdb_id) {
      const [game] = await db.select(
        "games",
        `id=eq.${row.igdb_id}&select=name`,
      );
      if (game?.name) return game.name;
    }
    return row.meta?.title_ids?.[0] ?? String(row.id);
  };
  const work = [
    ...[...changed].map(([id, pending]) => ({
      row: rows.find((r) => r.id === id),
      pending,
    })),
    ...missingTrophies()
      .filter((r) => !changed.has(r.id))
      .map((row) => ({ row, pending: null })),
  ].filter((w) => w.row);

  const unlockedBefore = new Map();
  if (work.length) {
    const ids = work.map((w) => w.row.id).join(",");
    for (const a of await db.select(
      "achievements",
      `owned_game_id=in.(${ids})&unlocked_at=not.is.null&select=owned_game_id`,
    ))
      unlockedBefore.set(
        a.owned_game_id,
        (unlockedBefore.get(a.owned_game_id) ?? 0) + 1,
      );
  }

  let step = 0;
  for (const { row, pending } of work) {
    if (Date.now() > deadline) break;
    step++;
    const title = await label(row);
    try {
      log(`Updating ${title} (${step}/${work.length})...`);
      const sets = (pending?.meta ?? row.meta).trophy_sets ?? [];
      const wantsTrophies =
        pending || row.playtime != null || row.meta?.ps_plus === false;
      if (sets.length && wantsTrophies) {
        const r = await loadPsnTrophies({
          db,
          ownedGameId: row.id,
          sets,
          authorization,
        });
        report.new_unlocks += Math.max(
          0,
          r.unlocked - (unlockedBefore.get(row.id) ?? 0),
        );
      }
      if (pending) {
        await db.update("player_games", `id=eq.${row.id}`, {
          ...pending,
          synced_at: new Date().toISOString(),
        });
        report.updated++;
      } else report.full_loads++;
    } catch (err) {
      report.failed.push({ game: title, error: err.message });
    }
  }
  report.unfinished = work.length - step;
  return report;
}

module.exports = { updatePsn };
