// The PlayStation adapter for _match.js. See the contract at the top of that file.
//
// A row's id is its Sony concept (meta.concept_id), which IGDB files as its
// PSN store id. PS3 rows have no concept, only a trophy list, so they go
// straight to the name search, limited to games IGDB lists on PS3.

const IGDB_PLATFORM = { ps3: 9, ps4: 48, ps5: 167 };
const PSN_SOURCE = 36;

// Sony's public catalogue: no sign-in, but country, language and age must all
// be given.
const CATALOGUE =
  "https://m.np.playstation.com/api/catalog/v2/concepts/{id}?age=99&country=GB&language=en-GB";

const platformId = (p) => (typeof p === "object" ? p?.id : p);

module.exports = function psnAdapter() {
  const versionOf = new Map();
  const detailCache = new Map();

  async function catalogue(id) {
    if (detailCache.has(id)) return detailCache.get(id);
    let out = null;
    if (/^\d+$/.test(id)) {
      try {
        const res = await fetch(CATALOGUE.replace("{id}", id));
        if (res.ok) {
          const c = await res.json();
          out = {
            name: c.nameEn || c.name || null,
            date: c.releaseDate?.date ? Date.parse(c.releaseDate.date) : null,
            developers: [],
            publishers: c.publisherName ? [c.publisherName] : [],
            website: null,
          };
        }
      } catch {
        // No details just means the search runs on the imported name alone.
      }
    }
    detailCache.set(id, out);
    return out;
  }

  const onConsole = (game, id) => {
    const want = IGDB_PLATFORM[versionOf.get(id)];
    const platforms = (game.platforms ?? []).map(platformId);
    return !want || !platforms.length || platforms.includes(want);
  };

  return {
    key: "playstation",
    rowFilter: "platform=eq.playstation",
    igdbSource: "psn",
    // PS4 and PS5 rows of one game share their IGDB game.
    perVersion: true,

    externalId(row) {
      if (row.meta?.concept_id != null) return String(row.meta.concept_id);
      return row.meta?.trophy_sets?.[0]?.id ?? null;
    },

    async prepare(batch) {
      for (const { row, id } of batch) versionOf.set(id, row.version);
    },

    /** Store details from the catalogue, one request per concept. */
    async details(ids) {
      const out = new Map();
      for (const id of ids) {
        const d = await catalogue(id);
        if (d) out.set(id, d);
      }
      return out;
    },

    /**
     * Sony's concept covers a game and all its editions, and IGDB files it on
     * one of them - sometimes an edition while the base game has no PSN link
     * (F1 25 -> "Iconic Edition"). Within that edition family, an edition is
     * chosen only when the catalogue's name contains its IGDB edition title
     * ("Weird West: Definitive Edition"); otherwise the base game is. Sony's
     * own suffixes ("PlayStation®4 Edition") name no IGDB edition, so they
     * don't count. Several named editions: the longest title, then the
     * closest release date. Members carrying a different PSN concept of their
     * own are other products, and members not on the row's console don't
     * fit; if the pick doesn't fit, the exact hit stays. Remasters and
     * remakes are separate IGDB games, not family members.
     */
    async refine(exact, { igdb }) {
      const better = new Map();
      const plain = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const families = await igdb.editionFamilies(exact.map((e) => e.linkId));
      for (const { id, linkId } of exact) {
        const family = families[linkId] ?? [];
        if (family.length < 2) continue;
        const store = await catalogue(id);
        if (!store?.name) continue;
        const psnIds = (g) =>
          (g.external_games ?? [])
            .filter((e) => e.external_game_source === PSN_SOURCE)
            .map((e) => String(e.uid));
        const fits = (g) => {
          if (g.id === linkId) return true;
          const own = psnIds(g);
          return (!own.length || own.includes(id)) && onConsole(g, id);
        };
        const gap = (g) =>
          store.date && g.first_release_date
            ? Math.abs(g.first_release_date * 1000 - store.date)
            : Infinity;
        const name = plain(store.name);
        const named = family
          .filter(
            (g) => g.version_title && name.includes(plain(g.version_title)),
          )
          .sort(
            (a, b) =>
              plain(b.version_title).length - plain(a.version_title).length ||
              gap(a) - gap(b),
          );
        const pick = named.length
          ? named[0]
          : family.find((g) => !g.version_parent);
        if (pick && pick.id !== linkId && fits(pick)) better.set(id, pick.id);
      }
      return better;
    },

    storeLinked(game, id) {
      return (game.external_games ?? []).some(
        (e) => e?.source === "psn" && String(e.uid) === String(id),
      );
    },

    /** A search candidate must be on the row's console, when IGDB says. */
    fits(game, id) {
      return onConsole(game, id);
    },
  };
};
