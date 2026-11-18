// The Xbox adapter for _match.js. See the contract at the top of that file.
//
// A row's id is its Xbox title id, which IGDB doesn't know. Only Microsoft
// Store games carry a store id IGDB files (meta.product_id); every other row,
// a PC game Xbox saw being launched, has nothing but its name, and only PC
// releases count.

const PC = 6;
const MS_SOURCES = new Set(["microsoft", "xgpc"]);

const platformId = (p) => (typeof p === "object" ? p?.id : p);

module.exports = function xboxAdapter() {
  const productOf = new Map();

  return {
    key: "xbox",
    rowFilter: "meta->>title_id=not.is.null",
    igdbSource: "microsoft",
    // A versionless row and a store row can share one game (Minecraft and
    // its launcher).
    perVersion: true,

    externalId(row) {
      const id = row.meta?.title_id;
      return id == null ? null : String(id);
    },

    async prepare(batch) {
      for (const { row, id } of batch)
        if (row.meta?.product_id) productOf.set(id, row.meta.product_id);
    },

    storeIds(id) {
      return productOf.has(id) ? [productOf.get(id)] : [];
    },

    // Xbox's own details (developer, publisher) need the owner's sign-in and
    // are too unreliable to score on, so the search uses the imported name.
    async details() {
      return new Map();
    },

    storeLinked(game, id) {
      const product = productOf.get(id);
      return Boolean(
        product &&
        (game.external_games ?? []).some(
          (e) => MS_SOURCES.has(e?.source) && String(e.uid) === product,
        ),
      );
    },

    fits(game) {
      return (game.platforms ?? []).map(platformId).includes(PC);
    },
  };
};
