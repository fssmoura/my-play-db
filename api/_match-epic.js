// The Epic adapter for _match.js. See the contract at the top of that file.
//
// A row is one Epic namespace (a game's whole store presence). IGDB files
// Epic games under store offer ids, not namespaces, so each run first reads
// the namespace's offers from the launcher catalog: the game's own offers
// (BASE_GAME, EDITION) are looked up exactly, and every offer id plus the
// store page slugs confirm search candidates. Delisted games have no offers
// and fall through to a search on the imported name.
//
// What the owner owns comes first. The account's entitlements are read too,
// and the exact lookup runs in two tiers:
//   1. offers the owner owns (every item the offer grants is entitled, or the
//      offer is named after an owned item no offer contains);
//   2. only then the store page's own offers, with the titles of owned items
//      no offer explains ("Enhanced Edition Audience") picking between hits.
// After an owned hit, an owned item named like an edition no offer sells any
// more upgrades the link to that IGDB edition of the game.
// In the name search, candidates not on PC or Mac, or first released over a
// year after the owner got the game, are ruled out.

const { epicGraphQL } = require("./epic");
const { nameSimilarity } = require("./_match");

const OWN_OFFERS = ["BASE_GAME", "EDITION"];
const DESKTOP = [6, 14]; // IGDB platforms: PC (Windows), Mac
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;
const ENTITLEMENTS =
  "https://entitlement-public-service-prod08.ol.epicgames.com/entitlement/api/account";
const PER_REQUEST = 10;
const EPIC_PAGE = /epicgames\.com\/(?:[^/?#]+\/)*?(?:p|product)\/([^/?#]+)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function catalogQuery(namespaces) {
  const parts = namespaces.map(
    (ns, i) =>
      `o${i}: catalogOffers(namespace: ${JSON.stringify(ns)}, params: { count: 200 }) { elements { id title offerType releaseDate items { id } developerDisplayName publisherDisplayName seller { name } offerMappings { pageSlug } } } ` +
      `n${i}: catalogNs(namespace: ${JSON.stringify(ns)}) { mappings(pageType: "productHome") { pageSlug } }`,
  );
  return `{ Catalog { ${parts.join(" ")} } }`;
}

/** One launcher request, retried: the endpoint drops connections now and then. */
async function fetchCatalog(namespaces) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { status, data } = await epicGraphQL({
        query: catalogQuery(namespaces),
      });
      // A delisted namespace makes catalogNs fail with a 404 in `errors`,
      // which still returns the other aliases.
      if (status === 200 && data?.data?.Catalog) return data.data.Catalog;
      lastError = new Error(`Epic catalog ${status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(1000 * (attempt + 1));
  }
  throw lastError;
}

async function fetchEntitlements(db) {
  const [cred] = await db.select(
    "platform_credentials",
    "platform=eq.epic&select=credentials,expires_at",
  );
  const { accessToken, epicAccountId } = cred?.credentials ?? {};
  if (!accessToken || !epicAccountId) throw new Error("Epic is not connected");
  if (cred.expires_at && Date.parse(cred.expires_at) <= Date.now())
    throw new Error("Epic sign-in has expired; refresh it first");
  const res = await fetch(
    `${ENTITLEMENTS}/${epicAccountId}/entitlements?start=0&count=5000`,
    { headers: { Authorization: `bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Epic entitlements ${res.status}`);
  return res.json();
}

/** Titles of catalog items, [{ ns, id }] -> Map id -> title. */
async function fetchItemTitles(items) {
  const out = new Map();
  for (let i = 0; i < items.length; i += PER_REQUEST) {
    const part = items.slice(i, i + PER_REQUEST);
    const query = `{ Catalog { ${part
      .map(
        ({ ns, id }, j) =>
          `i${j}: catalogItem(namespace: ${JSON.stringify(ns)}, id: ${JSON.stringify(id)}) { title }`,
      )
      .join(" ")} } }`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const { data } = await epicGraphQL({ query });
        const catalog = data?.data?.Catalog;
        if (catalog) {
          part.forEach(({ id }, j) => {
            const title = catalog[`i${j}`]?.title;
            if (title) out.set(id, title);
          });
          break;
        }
      } catch {
        // retried below
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  return out;
}

const plain = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function toMs(iso) {
  const ms = Date.parse(iso ?? "");
  // Epic uses far-future placeholder dates for unannounced releases.
  return Number.isFinite(ms) && new Date(ms).getUTCFullYear() < 2090
    ? ms
    : null;
}

module.exports = function epicAdapter() {
  const byNs = new Map(); // namespace -> { name, offers, slugs, owned... }

  return {
    key: "epic",
    rowFilter: "version=eq.epic",
    igdbSource: "epic",

    externalId(row) {
      return row.meta?.namespace ?? null;
    },

    async prepare(batch, { db }) {
      const owned = new Map(); // namespace -> { items, grantedAt }
      for (const e of await fetchEntitlements(db)) {
        if (!e?.namespace || !e.catalogItemId || e.active === false) continue;
        const entry = owned.get(e.namespace) ?? {
          items: new Set(),
          grantedAt: null,
        };
        entry.items.add(e.catalogItemId);
        const at = Date.parse(e.grantDate ?? "");
        if (
          Number.isFinite(at) &&
          (entry.grantedAt == null || at < entry.grantedAt)
        )
          entry.grantedAt = at;
        owned.set(e.namespace, entry);
      }

      for (let i = 0; i < batch.length; i += PER_REQUEST) {
        const part = batch.slice(i, i + PER_REQUEST);
        const catalog = await fetchCatalog(part.map((b) => b.id));
        part.forEach(({ row, id }, j) => {
          const offers = catalog[`o${j}`]?.elements ?? [];
          const slugs = new Set(
            [
              ...(catalog[`n${j}`]?.mappings ?? []),
              ...offers.flatMap((o) => o.offerMappings ?? []),
            ]
              .map((m) => m?.pageSlug?.toLowerCase())
              .filter(Boolean),
          );
          const mine = owned.get(id) ?? { items: new Set(), grantedAt: null };
          const ownedOffers = offers.filter(
            (o) =>
              o.items?.length && o.items.every((it) => mine.items.has(it.id)),
          );
          const explained = new Set(
            ownedOffers.flatMap((o) => o.items.map((it) => it.id)),
          );
          byNs.set(id, {
            name: row.meta?.name ?? null,
            offers,
            slugs,
            ownedOffers,
            unexplained: [...mine.items].filter((it) => !explained.has(it)),
            grantedAt: mine.grantedAt,
          });
        });
      }

      const titles = await fetchItemTitles(
        [...byNs].flatMap(([ns, e]) => e.unexplained.map((id) => ({ ns, id }))),
      );
      for (const entry of byNs.values()) {
        entry.ownedTitles = entry.unexplained
          .map((id) => titles.get(id))
          .filter(Boolean)
          .map((t) => plain(t.replace(/\baudience\b/gi, "")))
          .filter((t) => t.length >= 3);
        // An owned item no offer contains ("Platinum Edition Audience") makes
        // the own offer named after it owned too - unless the title is just
        // the base game's.
        const base = entry.offers
          .filter((o) => o.offerType === "BASE_GAME")
          .map((o) => ` ${plain(o.title)} `);
        const named = entry.ownedTitles.filter(
          (t) => !base.some((b) => b.includes(` ${t} `)),
        );
        entry.editionTitles = named;
        for (const o of entry.offers) {
          if (!OWN_OFFERS.includes(o.offerType)) continue;
          if (entry.ownedOffers.includes(o)) continue;
          const title = ` ${plain(o.title)} `;
          if (named.some((t) => title.includes(` ${t} `)))
            entry.ownedOffers.push(o);
        }
      }
    },

    storeIds(ns) {
      const entry = byNs.get(ns);
      if (!entry) return [];
      return [
        {
          ids: entry.ownedOffers.map((o) => o.id),
          how: "store_id",
          owned: true,
        },
        {
          ids: entry.offers
            .filter((o) => OWN_OFFERS.includes(o.offerType))
            .map((o) => o.id),
          how: "store_page",
        },
      ];
    },

    /** Several hits: keep those named like an owned item no offer explains. */
    prefer(games, ns) {
      const titles = byNs.get(ns)?.ownedTitles ?? [];
      if (!titles.length) return games;
      return games.filter((g) => {
        const name = ` ${plain(g.name)} `;
        return titles.some((t) => name.includes(` ${t} `));
      });
    },

    /**
     * An owned item named like an edition no offer sells any more ("Platinum
     * Edition Audience"): the one IGDB edition of the linked game with that
     * name.
     */
    async upgrade(base, ns, igdb) {
      const titles = byNs.get(ns)?.editionTitles ?? [];
      for (const t of titles) {
        const found = await igdb.search({ query: `${base.name} ${t}`, limit: 10 });
        const ids = found.map((g) => g.id).filter((id) => id !== base.id);
        if (!ids.length) continue;
        const editions = (await igdb.game({ ids })).filter((g) => {
          const parent = g.version_parent;
          const parentId = parent && typeof parent === "object" ? parent.id : parent;
          return parentId === base.id && ` ${plain(g.name)} `.includes(` ${t} `);
        });
        if (editions.length === 1) return editions[0];
      }
      return null;
    },

    fits(game, ns) {
      const platforms = (game.platforms ?? [])
        .map((p) => (p && typeof p === "object" ? p.id : p))
        .filter((p) => p != null);
      if (platforms.length && !platforms.some((p) => DESKTOP.includes(p)))
        return false;
      const grantedAt = byNs.get(ns)?.grantedAt;
      return !(
        grantedAt &&
        game.first_release_date &&
        game.first_release_date * 1000 > grantedAt + YEAR_MS
      );
    },

    /** The offer that best names the row stands in for the store page. */
    async details(namespaces) {
      const out = new Map();
      for (const ns of namespaces) {
        const entry = byNs.get(ns);
        const own = entry?.ownedOffers?.length
          ? entry.ownedOffers
          : (entry?.offers ?? []).filter((o) =>
              OWN_OFFERS.includes(o.offerType),
            );
        if (!own.length) continue;
        const score = (o) =>
          entry.name ? nameSimilarity(entry.name, o.title ?? "") : 0;
        const main = own
          .map((o) => ({ o, s: score(o), d: toMs(o.releaseDate) ?? Infinity }))
          .sort((a, b) => b.s - a.s || (a.d - b.d || 0))[0].o;
        out.set(ns, {
          name: main.title ?? null,
          date: toMs(main.releaseDate),
          developers: [main.developerDisplayName].filter(Boolean),
          publishers: [
            main.publisherDisplayName ?? main.seller?.name,
          ].filter(Boolean),
          website: null,
        });
      }
      return out;
    },

    storeLinked(game, ns) {
      const entry = byNs.get(ns);
      if (!entry) return false;
      const offerIds = new Set(entry.offers.map((o) => o.id));
      if (
        (game.external_games ?? []).some(
          (e) => e?.source === "epic" && offerIds.has(String(e.uid)),
        )
      ) {
        return true;
      }
      return (game.websites ?? []).some((w) => {
        const slug = EPIC_PAGE.exec(w?.url ?? "")?.[1]?.toLowerCase();
        return Boolean(slug) && entry.slugs.has(slug);
      });
    },
  };
};
