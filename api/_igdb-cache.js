// Server copy of toDetailRow() from public/js/games-cache.js and
// normalizeName() from public/js/ranking.js. Those are browser modules and
// cannot be required here. Keep `name_normalized` identical to ranking.js, or
// rows written by the matcher stop lining up with the app's own search.

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function companyNames(game, role) {
  const names = (game.involved_companies ?? [])
    .filter((entry) => entry?.[role] && entry.company?.name)
    .map((entry) => entry.company.name);
  return names.length ? [...new Set(names)] : null;
}

function urls(list) {
  const out = (list ?? []).map((item) => item?.url).filter(Boolean);
  return out.length ? out : null;
}

function ids(list) {
  const out = (list ?? [])
    .map((item) => (typeof item === "object" ? item?.id : item))
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  return out.length ? out : null;
}

function refId(value) {
  if (value == null) return null;
  const id = typeof value === "object" ? value.id : value;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

/** IGDB game (from igdb.js `game`) -> the `cache_game_details` payload. */
function toDetailRow(game) {
  if (!game?.id || !game?.name || !game?.slug) return null;

  const externalIds = {};
  for (const entry of game.external_games ?? []) {
    if (!entry?.source || !entry?.uid) continue;
    (externalIds[entry.source] ??= []).push(String(entry.uid));
  }

  const popularity = game.popularity;
  const hasPopularity =
    popularity && typeof popularity === "object"
      ? Object.keys(popularity).length > 0
      : false;
  const genres = (game.genres ?? []).map((g) => g?.name).filter(Boolean);

  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    name_normalized: normalizeName(game.name),
    summary: game.summary ?? null,
    storyline: game.storyline ?? null,
    genres: genres.length ? genres : null,
    cover: game.cover?.url ? [game.cover.url] : null,
    screenshots: urls(game.screenshots),
    artworks: urls(game.artworks),
    developer: companyNames(game, "developer"),
    publisher: companyNames(game, "publisher"),
    game_type: game.game_type ?? null,
    release_dates: game.release_dates ?? null,
    platforms: game.platforms ?? null,
    rating: game.total_rating ?? null,
    rating_count: game.total_rating_count ?? null,
    videos: game.videos ?? null,
    websites: game.websites ?? null,
    collections: game.collections ?? null,
    franchises: game.franchises ?? null,
    dlcs: ids(game.dlcs),
    bundles: ids(game.bundles),
    standalone_expansions: ids(game.standalone_expansions),
    remasters: ids(game.remasters),
    remakes: ids(game.remakes),
    expansions: ids(game.expansions),
    expanded_games: ids(game.expanded_games),
    similar_games: ids(game.similar_games),
    parent_game: refId(game.parent_game),
    version_title: game.version_title ?? null,
    version_parent: refId(game.version_parent),
    external_ids: Object.keys(externalIds).length ? externalIds : null,
    alternative_names: game.alternative_names ?? null,
    popularity: hasPopularity ? popularity : null,
    hypes: game.hypes ?? null,
    first_release_date: game.first_release_date ?? null,
  };
}

module.exports = { toDetailRow, normalizeName };
