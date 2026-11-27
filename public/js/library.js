// The owner's library: every game in `player_games`, one entry per IGDB game
// (the same game on two stores is one entry), most recently played first, in
// the shape search results use. No DOM. Used by search's In Library filter,
// the results page's In Library pill and the game page's store marks.
//
// Events: "change" (the list was loaded or reloaded).
import { supabase } from "/js/supabase.js";
import { getAccessToken } from "/js/session.js";
import { fromDbRow } from "/js/games-cache.js";
import { matchScore, rankGames } from "/js/ranking.js";

// Cards and ranking need no platforms or release-date list, which are most of
// the weight; the card's year comes from first_release_date. One achievement
// per copy (at most) says whether it has a list, without loading it.
const COLUMNS =
  "igdb_id, platform, version, last_played, games(id, name, slug, game_type, first_release_date, " +
  "cover, alternative_names, popularity, hypes, rating_count), achievements(owned_game_id)";
const PAGE = 1000;
// load() is called on every search; anything younger is reused.
const FRESH_MS = 60_000;

async function fetchRows() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_games")
      .select(COLUMNS)
      .not("igdb_id", "is", null)
      .limit(1, { referencedTable: "achievements" })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Latest play across every store copy of a game; never-played games go last,
// alphabetically.
function toList(rows) {
  const byGame = new Map();
  for (const row of rows) {
    if (!row.games) continue;
    const played = row.last_played ? Date.parse(row.last_played) : 0;
    const held = byGame.get(row.igdb_id);
    if (!held) byGame.set(row.igdb_id, { game: fromDbRow(row.games), played });
    else if (played > held.played) held.played = played;
  }
  return [...byGame.values()]
    .sort(
      (a, b) => b.played - a.played || a.game.name.localeCompare(b.game.name),
    )
    .map((entry) => entry.game);
}

// Every copy held of each game: igdb_id -> [{ platform, version,
// achievements }], achievements being whether its list is stored.
function toCopies(rows) {
  const byGame = new Map();
  for (const { igdb_id, platform, version, achievements } of rows) {
    if (!byGame.has(igdb_id)) byGame.set(igdb_id, []);
    byGame
      .get(igdb_id)
      .push({ platform, version, achievements: !!achievements?.length });
  }
  return byGame;
}

export function createLibrary() {
  let games = [];
  let ids = new Set();
  let copies = new Map();
  let ready = false;
  let loading = null;
  let loadedAt = 0;
  const listeners = new Map();

  // Loads (or reloads, if it's over a minute old or `force`) the list. What is
  // held stays usable meanwhile; a failed reload keeps it.
  function load({ force = false } = {}) {
    if (!force && ready && Date.now() - loadedAt < FRESH_MS) {
      return Promise.resolve();
    }
    loading ??= (async () => {
      try {
        const rows = await fetchRows();
        games = toList(rows);
        copies = toCopies(rows);
        ids = new Set(games.map((game) => game.id));
        ready = true;
        loadedAt = Date.now();
        emit("change");
      } catch (error) {
        console.warn("Library didn't load", error);
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // Asks every store for new games and play times (/api/library-sync, which
  // skips a store synced in the last 15 minutes, 1 with `force`), then
  // reloads the list. Emits "syncstart", "syncprogress" (0-1) and "syncend";
  // a failure just leaves what is held. A call while one runs joins it.
  //
  // Progress is read from the server's lines: each store is an equal share,
  // full once it says "finished", and filled meanwhile by its "(3/10)" steps
  // (never backwards; Steam counts through more than one pass). The last 5%
  // is the list reloading.
  let syncing = null;
  function sync({ force = false } = {}) {
    syncing ??= (async () => {
      emit("syncstart");
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/library-sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(force ? { force: true } : {}),
        });
        if (!res.ok || !res.body) return;
        const shares = new Map();
        const report = () => {
          if (!shares.size) return;
          let sum = 0;
          for (const share of shares.values()) sum += share;
          emit("syncprogress", (sum / shares.size) * 0.95);
        };
        const read = (line) => {
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            return;
          }
          if (Array.isArray(msg.platforms)) {
            for (const platform of msg.platforms) shares.set(platform, 0);
          } else if (msg.finished) {
            shares.set(msg.platform, 1);
          } else if (msg.step && shares.has(msg.platform)) {
            const count = /\((\d+)\/(\d+)\)/.exec(msg.step);
            const share = count ? 0.1 + (0.9 * count[1]) / count[2] : 0.05;
            shares.set(msg.platform, Math.max(shares.get(msg.platform), share));
          } else return;
          report();
        };
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop();
          for (const line of lines) if (line.trim()) read(line);
        }
        await load({ force: true });
      } catch (error) {
        console.warn("Library sync failed", error);
      } finally {
        syncing = null;
        emit("syncend");
      }
    })();
    return syncing;
  }

  function emit(event, value) {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(value);
  }

  return {
    get ready() {
      return ready;
    },
    // Most recently played first.
    get games() {
      return games;
    },
    has: (id) => ids.has(Number(id)),
    // The game's copies ({ platform, version, achievements }), one per store;
    // empty if not owned.
    copies: (id) => copies.get(Number(id)) ?? [],
    // The game's cover changed (Customize saved): updated in place.
    setCover(id, cover) {
      for (const game of games) if (game.id === Number(id)) game.cover = cover;
    },
    // Owned games matching a query on their title (or another name), ranked
    // the same way search ranks.
    search(query) {
      const term = String(query ?? "").trim();
      return rankGames(
        games.filter((game) => matchScore(game, term) > 0),
        term,
      );
    },
    load,
    sync,
    get syncing() {
      return Boolean(syncing);
    },
    // "change" (the list reloaded), "syncstart", "syncprogress", "syncend".
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
  };
}
