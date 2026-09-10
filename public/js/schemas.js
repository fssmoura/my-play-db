/**
 * Parameter schemas for the API console.
 *
 * One entry per platform.action, describing the options that action accepts so
 * the console can render a real form instead of asking for raw JSON.
 *
 * Credentials (accessToken, steamId, xuid...) are NOT listed here - they are
 * injected automatically from the vault by platforms.js/callCredentials.
 *
 * Field shape:
 *   name        key sent in `options`
 *   type        "string" | "number" | "boolean" | "json" | "select"
 *   required    blocks Run until filled
 *   default     prefilled value
 *   placeholder example value, shown greyed out
 *   hint        one-line explanation
 *   options     for type "select"
 */

const NONE = [];

export const SCHEMAS = {
  psn: {
    profile: NONE,
    games: [
      {
        name: "limit",
        type: "number",
        hint: "Return only the N most recently played. Omit for the full library.",
        placeholder: "10",
      },
      {
        name: "offset",
        type: "number",
        hint: "Skip this many titles before returning results.",
        placeholder: "0",
      },
    ],
    titles: [
      {
        name: "limit",
        type: "number",
        hint: "Max trophy titles to return. Omit to auto-paginate everything.",
        placeholder: "50",
      },
      {
        name: "offset",
        type: "number",
        hint: "Skip this many titles.",
        placeholder: "0",
      },
    ],
    recent: [
      {
        name: "limit",
        type: "number",
        default: 50,
        hint: "How many recently played games to return.",
      },
      {
        name: "categories",
        type: "json",
        hint: 'Optional category filter, e.g. ["ps4_game","ps5_native_game"]',
        placeholder: '["ps5_native_game"]',
      },
    ],
    trophymap: [
      {
        name: "titleIds",
        type: "json",
        required: true,
        hint: "Array of PSN title IDs. Get these from `games` -> meta.title_ids.",
        placeholder: '["PPSA27360_00","CUSA52314_00"]',
      },
    ],
    trophies: [
      {
        name: "npCommunicationId",
        type: "string",
        required: true,
        hint: "Trophy set ID. Comes from `trophymap`.",
        placeholder: "NPWR49547_00",
      },
      {
        name: "npServiceName",
        type: "select",
        required: true,
        default: "trophy2",
        options: ["trophy2", "trophy"],
        hint: "trophy2 for PS5 titles, trophy for PS4.",
      },
    ],
  },

  steam: {
    profile: NONE,
    games: NONE,
    recent: [
      {
        name: "count",
        type: "number",
        hint: "How many recently played games (last 2 weeks) to return.",
        placeholder: "10",
      },
    ],
    game: [
      {
        name: "appids",
        type: "json",
        required: true,
        hint: "One appid or an array of them. Steam store metadata.",
        placeholder: "[252950, 570]",
      },
    ],
    schemas: [
      {
        name: "appid",
        type: "number",
        required: true,
        hint: "Achievement definitions for this game.",
        placeholder: "252950",
      },
    ],
    achievements: [
      {
        name: "appid",
        type: "number",
        required: true,
        hint: "Your earned achievements for this game.",
        placeholder: "252950",
      },
    ],
  },

  epic: {
    library: [
      {
        name: "resolveNames",
        type: "boolean",
        hint: "Call the catalog to replace internal codenames with real titles. Slower.",
      },
    ],
    catalog: [
      {
        name: "items",
        type: "json",
        required: true,
        hint: "Array of { namespace, catalogItemId } - both come from `library`.",
        placeholder: '[{"namespace":"jackal","catalogItemId":"abc123"}]',
      },
    ],
    progress: [
      {
        name: "sandboxIds",
        type: "json",
        hint: "Namespaces to check. Omit to scan the whole library.",
        placeholder: '["jackal"]',
      },
      {
        name: "resolveNames",
        type: "boolean",
        hint: "Include readable game names in the response.",
      },
      {
        name: "names",
        type: "json",
        hint: 'Optional name map, e.g. {"jackal":"Dauntless"}',
        placeholder: '{"jackal":"Dauntless"}',
      },
    ],
    achievements: [
      {
        name: "sandboxId",
        type: "string",
        required: true,
        hint: "The game's namespace, from `library` -> namespace.",
        placeholder: "jackal",
      },
      {
        name: "sandboxName",
        type: "string",
        hint: "Optional display name to echo back in the response.",
        placeholder: "Dauntless",
      },
      {
        name: "catalogItemId",
        type: "string",
        hint: "Optional, echoed back for convenience.",
      },
    ],
  },

  xbox: {
    profile: NONE,
    games: NONE,
    achievements: [
      {
        name: "titleId",
        type: "string",
        required: true,
        hint: "From `games` -> titles[].titleId.",
        placeholder: "1820250788",
      },
    ],
  },

  ea: {
    library: NONE,
    achievements: [
      {
        name: "achievementSetOverride",
        type: "string",
        required: true,
        hint: "From `library`. Null there means the game has no achievements.",
        placeholder: "50072_194927_50844",
      },
      {
        name: "sandboxName",
        type: "string",
        hint: "Optional display name to echo back.",
      },
    ],
  },

  igdb: {
    auth: NONE,
    search: [
      {
        name: "query",
        type: "string",
        required: true,
        hint: "Game name to search for.",
        placeholder: "Elden Ring",
      },
      {
        name: "limit",
        type: "number",
        default: 200,
        hint: "Max results. IGDB caps search at 500.",
      },
      { name: "offset", type: "number", hint: "Skip this many results." },
      {
        name: "type",
        type: "number",
        hint: "Filter by game_type. 0 = main game, 1 = DLC, 2 = expansion, 3 = bundle.",
        placeholder: "0",
      },
    ],
    game: [
      {
        name: "ids",
        type: "json",
        required: true,
        hint: "One IGDB id or an array of them.",
        placeholder: "[119133]",
      },
    ],
    by_external: [
      {
        name: "source",
        type: "select",
        required: true,
        default: "steam",
        options: [
          "steam",
          "psn",
          "epic",
          "xbox",
          "gog",
          "microsoft",
          "xgpc",
          "itch",
          "android",
        ],
        hint: "Which external store the uid belongs to.",
      },
      {
        name: "uid",
        type: "string",
        required: true,
        hint: "The store's own ID, e.g. a Steam appid or PSN concept id.",
        placeholder: "252950",
      },
    ],
  },

  sgdb: {
    search: [
      {
        name: "name",
        type: "string",
        required: true,
        hint: "Game name to search SteamGridDB for.",
        placeholder: "Elden Ring",
      },
    ],
    game: [
      {
        name: "sgdbId",
        type: "number",
        hint: "SteamGridDB game id (from `search`).",
        placeholder: "5277816",
      },
      {
        name: "platform",
        type: "select",
        options: [
          "",
          "steam",
          "origin",
          "egs",
          "bnet",
          "uplay",
          "flashpoint",
          "eshop",
        ],
        hint: "Alternative to sgdbId: look up by a store's own id.",
      },
      {
        name: "platformId",
        type: "string",
        hint: "The store id, used with platform.",
        placeholder: "252950",
      },
    ],
    grids: ASSET_FIELDS(),
    heroes: ASSET_FIELDS(),
    logos: ASSET_FIELDS({ dimensions: false }),
  },
};

/** grids/heroes/logos share the same long filter list. */
function ASSET_FIELDS({ dimensions = true } = {}) {
  const fields = [
    {
      name: "sgdbId",
      type: "number",
      hint: "SteamGridDB game id (from `search`).",
      placeholder: "5277816",
    },
    {
      name: "platform",
      type: "select",
      options: [
        "",
        "steam",
        "origin",
        "egs",
        "bnet",
        "uplay",
        "flashpoint",
        "eshop",
      ],
      hint: "Alternative to sgdbId: look up by a store's own id.",
    },
    {
      name: "platformId",
      type: "string",
      hint: "The store id, used with platform.",
      placeholder: "252950",
    },
    {
      name: "styles",
      type: "string",
      hint: "Comma-separated styles, e.g. alternate,blurred",
      placeholder: "alternate",
    },
  ];
  if (dimensions) {
    fields.push({
      name: "dimensions",
      type: "string",
      hint: "Comma-separated sizes, e.g. 600x900,342x482",
      placeholder: "600x900",
    });
  }
  fields.push(
    {
      name: "mimes",
      type: "string",
      hint: "Comma-separated, e.g. image/png,image/webp",
      placeholder: "image/png",
    },
    {
      name: "types",
      type: "select",
      options: ["", "static", "animated"],
      hint: "Still images or animated ones.",
    },
    {
      name: "nsfw",
      type: "select",
      options: ["", "any", "true", "false"],
      hint: "Defaults to any.",
    },
    {
      name: "humor",
      type: "select",
      options: ["", "any", "true", "false"],
      hint: "Defaults to any.",
    },
    {
      name: "epilepsy",
      type: "select",
      options: ["", "any", "true", "false"],
      hint: "Defaults to any.",
    },
    {
      name: "limit",
      type: "number",
      hint: "Results per page.",
      placeholder: "50",
    },
    {
      name: "page",
      type: "number",
      hint: "Page number, starting at 0.",
      placeholder: "0",
    },
  );
  return fields;
}

/** Fields for one platform.action, or null when we have no schema for it. */
export function fieldsFor(platform, action) {
  return SCHEMAS[platform]?.[action] ?? null;
}
