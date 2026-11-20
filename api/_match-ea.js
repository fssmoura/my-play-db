// The EA adapter for _match.js. See the contract at the top of that file.
//
// A row's id is its EA offer id, which IGDB doesn't know. EA's own catalogue
// lists the same game on other stores (`firstParties`), and IGDB does file
// some of those: the Steam app id, and Microsoft Store product ids. Those are
// looked up exactly, but they are EA's cross-references, not what the owner
// bought there - the Microsoft id can be an edition (NFS Heat's is the Deluxe
// Edition) - so an exact hit is refined to the edition EA's own name names,
// otherwise the base game. Everything else goes to the name search, on EA's
// name and release date, PC games only.

const { ensureFreshAccess } = require("./_platform-refresh");
const { eaGraphQL } = require("./ea");

const PC = 6;
const MS_SOURCES = new Set(["microsoft", "xgpc"]);
const MS_PRODUCT = /^[0-9A-Z]{12}$/;

const platformId = (p) => (p && typeof p === "object" ? p.id : p);
const plain = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const onPc = (game) => {
  const platforms = (game.platforms ?? []).map(platformId);
  return !platforms.length || platforms.includes(PC);
};

module.exports = function eaAdapter() {
  const byOffer = new Map(); // offer id -> { name, offerName, date, steam, microsoft }

  return {
    key: "ea",
    rowFilter: "version=eq.ea&meta->>origin_offer_id=not.is.null",
    igdbSource: null,

    externalId(row) {
      return row.meta?.origin_offer_id ?? null;
    },

    async prepare(batch, { db }) {
      const { accessToken } = await ensureFreshAccess(db, "ea");
      for (let i = 0; i < batch.length; i += 100) {
        const part = batch.slice(i, i + 100);
        const data = await eaGraphQL(
          `query offers($offerIds: [String!]!) { legacyOffers(offerIds: $offerIds, locale: "DEFAULT") { offerId: id displayName releaseDate firstParties { partner partnerId partnerIdType } } }`,
          accessToken,
          { offerIds: part.map((b) => b.id) },
        );
        const offers = new Map(data.legacyOffers.map((o) => [o.offerId, o]));
        for (const { row, id } of part) {
          const o = offers.get(id) ?? {};
          const parties = o.firstParties ?? [];
          const date = Date.parse(o.releaseDate ?? "");
          byOffer.set(id, {
            name: row.meta?.name ?? null,
            offerName: o.displayName ?? null,
            date: Number.isFinite(date) ? date : null,
            steam: parties
              .filter(
                (p) =>
                  p.partner === "STEAM" && p.partnerIdType === "CONTENT_ID",
              )
              .map((p) => String(p.partnerId)),
            microsoft: parties
              .filter(
                (p) =>
                  ["MICROSOFT", "UNKNOWN"].includes(p.partner) &&
                  MS_PRODUCT.test(p.partnerId),
              )
              .map((p) => String(p.partnerId)),
          });
        }
      }
    },

    storeIds(id) {
      const entry = byOffer.get(id);
      if (!entry) return [];
      return [
        { ids: entry.steam, how: "steam_id", source: "steam" },
        { ids: entry.microsoft, how: "microsoft_id", source: "microsoft" },
      ];
    },

    /**
     * Within the hit's edition family: the edition whose IGDB edition title
     * EA's name contains (longest first), otherwise the base game. PC only.
     */
    async refine(exact, { igdb }) {
      const better = new Map();
      const families = await igdb.editionFamilies(exact.map((e) => e.linkId));
      for (const { id, linkId } of exact) {
        const family = (families[linkId] ?? []).filter(onPc);
        if (family.length < 2) continue;
        const entry = byOffer.get(id);
        const name = plain(`${entry?.name ?? ""} ${entry?.offerName ?? ""}`);
        const named = family
          .filter(
            (g) => g.version_title && name.includes(plain(g.version_title)),
          )
          .sort(
            (a, b) =>
              plain(b.version_title).length - plain(a.version_title).length,
          );
        const pick = named[0] ?? family.find((g) => !g.version_parent);
        if (pick && pick.id !== linkId) better.set(id, pick.id);
      }
      return better;
    },

    async details(ids) {
      const out = new Map();
      for (const id of ids) {
        const entry = byOffer.get(id);
        if (!entry) continue;
        out.set(id, {
          name: entry.offerName ?? entry.name,
          date: entry.date,
          developers: [],
          publishers: [],
          website: null,
        });
      }
      return out;
    },

    storeLinked(game, id) {
      const entry = byOffer.get(id);
      if (!entry) return false;
      return (game.external_games ?? []).some(
        (e) =>
          (e?.source === "steam" && entry.steam.includes(String(e.uid))) ||
          (MS_SOURCES.has(e?.source) &&
            entry.microsoft.includes(String(e.uid))),
      );
    },

    fits(game) {
      return onPc(game);
    },
  };
};
