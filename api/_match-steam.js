// The Steam adapter for _match.js. See the contract at the top of that file.

const steam = require("./steam");

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Steam store dates are display strings in either order ("27 Oct, 2022" or
 * "Oct 27, 2022"), or text like "Coming soon". Returns ms or null.
 */
function parseStoreDate(text) {
  const s = String(text ?? "").toLowerCase();
  const dayFirst = /(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(s);
  const monthFirst = /([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  let y, m, d;
  if (dayFirst && MONTHS[dayFirst[2]] != null) [, d, m, y] = dayFirst;
  else if (monthFirst && MONTHS[monthFirst[1]] != null)
    [, m, d, y] = monthFirst;
  else return null;
  return Date.UTC(Number(y), MONTHS[m], Number(d));
}

const STEAM_APP_URL = /store\.steampowered\.com\/app\/(\d+)/i;

module.exports = {
  key: "steam",
  rowFilter: "version=eq.steam",
  igdbSource: "steam",

  externalId(row) {
    const appid = row.meta?.appid;
    return appid == null ? null : String(appid);
  },

  /** Store details, one request per appid. Only called for exact-lookup misses. */
  async details(appids) {
    const out = new Map();
    for (const appid of appids) {
      try {
        const res = await steam.actions.game({ appids: [appid] });
        const data = res?.[appid]?.success ? res[appid].data : null;
        if (!data) continue;
        out.set(String(appid), {
          name: data.name ?? null,
          date: parseStoreDate(data.release_date?.date),
          developers: data.developers ?? [],
          publishers: data.publishers ?? [],
          website: data.website ?? null,
        });
      } catch {
        // No details just means the search runs on the imported name alone.
      }
    }
    return out;
  },

  storeLinked(game, appid) {
    if (
      (game.external_games ?? []).some(
        (e) => e?.source === "steam" && String(e.uid) === String(appid),
      )
    ) {
      return true;
    }
    return (game.websites ?? []).some(
      (w) => STEAM_APP_URL.exec(w?.url ?? "")?.[1] === String(appid),
    );
  },
};
