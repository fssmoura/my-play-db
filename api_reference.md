# API Reference

> Live-testing results via `vercel dev` — PSN, Steam, Epic, Xbox, EA (2026-06-12), IGDB, SGDB (2026-06-15).

---

## PSN (`api/psn.js`)

Account: **xoura7** — Level 281, Tier 3, 17 Platinums

### `auth`

**Request**: `npsso` (short-lived cookie) or `refreshToken`

```json
{
  "accessToken": "JWT (1h expiry)",
  "accessTokenExpiry": "2026-06-12T14:31:08.658Z",
  "refreshToken": "uuid (10d expiry)",
  "refreshTokenExpiry": "2026-06-22T13:31:08.658Z"
}
```

**Notes**:
- NPSSO expires very quickly (~minutes). Always use `refreshToken` for subsequent calls.
- `refreshToken` is a plain UUID, not a JWT.
- `expiresIn` from psn-api is in seconds — the handler converts to ISO.
- `accessTokenExpiry` is ~1h, `refreshTokenExpiry` is ~10d.

---

### `profile`

**Request**: `accessToken`

```json
{
  "profile": {
    "onlineId": "xoura7",
    "personalDetail": {
      "firstName": "Francisco",
      "lastName": "Moura",
      "profilePictures": [
        { "size": "s", "url": "..." },
        { "size": "m", "url": "..." },
        { "size": "l", "url": "..." },
        { "size": "xl", "url": "..." }
      ]
    },
    "aboutMe": "",
    "avatars": [
      { "size": "s", "url": "..." },
      { "size": "m", "url": "..." },
      { "size": "l", "url": "..." },
      { "size": "xl", "url": "..." }
    ],
    "languages": ["pt-PT", "en-US"],
    "isPlus": true,
    "isOfficiallyVerified": false,
    "isMe": true
  },
  "presence": {
    "basicPresence": {
      "availability": "unavailable",
      "lastAvailableDate": "2026-06-12T12:31:53.046Z",
      "primaryPlatformInfo": {
        "onlineStatus": "offline",
        "platform": "PS5",
        "lastOnlineDate": "2026-06-12T12:31:53.046Z"
      }
    }
  },
  "trophySummary": {
    "accountId": "6476945729884360078",
    "trophyLevel": 281,
    "trophyPoint": 51390,
    "tier": 3,
    "earnedTrophies": { "bronze": 1580, "silver": 405, "gold": 116, "platinum": 17 }
  }
}
```

**Key fields for storage**:
- `onlineId` — PSN display name
- `profilePictures` — avatar URLs by size (s/m/l/xl)
- `isPlus` — PS Plus subscriber
- `presence` — last online date per platform (PS5)
- `trophyLevel` / `tier` — aggregate trophy stats
- `earnedTrophies` — counts per tier

---

### `games`

**Request**: `accessToken` + `{ limit: 2 }`

```json
{
  "titles": [
    {
      "titleId": "PPSA27360_00",
      "name": "EA SPORTS FC™ 26",
      "category": "ps5_native_game",
      "service": "none(purchased)",
      "playCount": 62,
      "playDuration": "PT106H56M38S",
      "firstPlayedDateTime": "2025-09-29T09:10:11.290000Z",
      "lastPlayedDateTime": "2026-06-11T23:50:28.250000Z",
      "imageUrl": "https://image.api.playstation.com/...",
      "concept": {
        "id": 10011898,
        "titleIds": ["CUSA52314_00", "PPSA27360_00", ...],
        "genres": ["SPORTS", "SIMULATION"],
        "localizedName": { "defaultLanguage": "en-US", "metadata": { "pt-PT": "...", ... } },
        "media": { "images": [{"type": "GAMEHUB_COVER_ART", "url": "..."}, ...] }
      }
    }
  ],
  "totalItemCount": 172
}
```

**Key observations**:
- `playDuration` is ISO 8601 duration (`PT106H56M38S` = 106h56m) — needs parsing
- `playCount` is an integer (62 times launched)
- `category`: `ps4_game` / `ps5_native_game` / `pspc_game`
- `service`: `none(purchased)` / `ps_plus` / `ps_now`
- `concept.id` = numeric concept ID, `concept.titleIds` = all SKUs sharing this concept
- Media images have types: `GAMEHUB_COVER_ART`, `HERO_CHARACTER`, `LOGO`, `SCREENSHOT`, `MASTER`, `BACKGROUND_LAYER_ART`, `FOUR_BY_THREE_BANNER`, `PORTRAIT_BANNER`
- Auto-paginates by default (pages of 100). `limit` returns exactly N most recent.
- Total games: 172

**`totalItemCount` vs `games` limit**: When `limit` is set, `totalItemCount` is the total available (not just the returned count). Without `limit`, the handler auto-paginates and returns all plus `totalItemCount`.

---

### `recent`

**Request**: `accessToken` + `{ limit: 5 }`

```json
{
  "games": [
    {
      "__typename": "GameLibraryTitle",
      "conceptId": "10011898",
      "entitlementId": "UP0006-PPSA27360_00-EASPORTSFC2026BG",
      "image": { "url": "..." },
      "isActive": true,
      "lastPlayedDateTime": "2026-06-11T23:50:28.250000Z",
      "name": "EA SPORTS FC 26",
      "platform": "PS5",
      "productId": "UP0006-PPSA27360_00-26STANDARDBUNDLE",
      "subscriptionService": "NONE",
      "titleId": "PPSA27360_00"
    }
  ]
}
```

**Key observations**:
- Lighter than `games` — no playtime, no play count, no concept metadata
- Has `conceptId` (numeric string) and `entitlementId` (product entitlement)
- `subscriptionService`: `NONE` / `PS_PLUS_EXTRA` / etc.
- `isActive`: true/false (service entitlements can expire)
- No pagination — returns all recent activity
- Default limit 50 per AGENTS.md

---

### `titles`

**Request**: `accessToken` + `{ limit: 2 }`

```json
{
  "trophyTitles": [
    {
      "npServiceName": "trophy2",
      "npCommunicationId": "NPWR49547_00",
      "trophySetVersion": "01.01",
      "trophyTitleName": "EA SPORTS FC™ 26 Trophies",
      "trophyTitleIconUrl": "https://psnobj.prod.dl.playstation.net/...",
      "trophyTitlePlatform": "PS5",
      "hasTrophyGroups": false,
      "definedTrophies": { "bronze": 28, "silver": 12, "gold": 3, "platinum": 1 },
      "progress": 28,
      "earnedTrophies": { "bronze": 12, "silver": 4, "gold": 0, "platinum": 0 },
      "lastUpdatedDateTime": "2026-06-05T14:19:54Z"
    }
  ],
  "totalItemCount": 164
}
```

**Key observations**:
- **This is the primary sync entry point** — ordered by most recent trophy activity
- `progress` is a percentage (0-100) — calculated from defined vs earned
- `lastUpdatedDateTime` = when the last trophy was earned (use for incremental sync)
- `npCommunicationId` = the key needed for `trophies` action (e.g. `NPWR49547_00`)
- `npServiceName` = always `"trophy2"` for PS4/PS5 (legacy PS3/Vita used `"trophy"`)
- `hasTrophyGroups`: true = game has DLC trophy groups (e.g. Ghost of Yōtei has 3 groups)
- `definedTrophies` vs `earnedTrophies` — counts per tier, not individual trophies
- Total trophy titles: 164 (less than 172 total games — some games have no trophies)

---

### `trophymap`

**Request**: `accessToken` + `{ titleIds: ["PPSA27360_00", "PPSA02343_00"] }`

```json
{
  "resolved": {
    "PPSA27360_00": {
      "npCommunicationId": "NPWR49547_00",
      "npServiceName": "trophy2"
    },
    "PPSA02343_00": {
      "npCommunicationId": "NPWR22459_00",
      "npServiceName": "trophy2"
    }
  },
  "unresolved": []
}
```

**Key observations**:
- Input: `titleId` strings from `games`/`recent` responses (e.g. `"PPSA27360_00"`)
- Output: maps to `npCommunicationId` + `npServiceName` needed for `trophies`
- NOT concept IDs — passing `concept.id` numeric values (e.g. `10011898`) resolves nothing
- Falls back to proxy account (`TROPHY_PROXY_ACCOUNT_ID = "6515971742264256071"`) for titles the user hasn't synced — this ensures even unplayed games get mapped
- Batches 5 at a time, concurrency 10 — fast for large title lists
- Essential bridge between `games` → `trophies` pipeline

---

### `trophies`

**Request**: `accessToken` + `{ npCommunicationId: "NPWR49547_00", npServiceName: "trophy2" }`

```json
{
  "npCommunicationId": "NPWR49547_00",
  "npServiceName": "trophy2",
  "trophySetVersion": "01.01",
  "hasTrophyGroups": false,
  "totalItemCount": 44,
  "trophies": [
    {
      "trophyId": 0,
      "trophyHidden": false,
      "trophyType": "platinum",
      "trophyName": "Accolade Collector",
      "trophyDetail": "Unlock all other trophies (excluding additional content trophies)",
      "trophyIconUrl": "https://psnobj.prod.dl.playstation.net/...",
      "trophyGroupId": "default",
      "trophyRare": 0,
      "trophyEarnedRate": "0.1",
      "earned": false,
      "earnedDateTime": null
    }
  ]
}
```

**Key observations**:
- `trophyType`: `"platinum"` / `"gold"` / `"silver"` / `"bronze"`
- `trophyRare`: 0 = common, 1 = rare, 2 = very rare (Sony's internal rarity tiers)
- `trophyEarnedRate`: global percentage of players who earned this (e.g. `"0.1"`)
- `earned`: boolean — merged from `getUserTrophiesEarnedForTitle` vs definitions
- `earnedDateTime`: ISO string when earned, `null` if not earned
- `trophyGroupId`: `"default"` for base game, other values for DLC groups
- If user hasn't synced the game: falls back to proxy account → `earned: false` for all trophies
- Merges definitions + earned data in a single response (no client-side merge needed)

---

### PSN Data Flow

```
auth ──► refreshToken (persist)
  │
  ├──► profile ──► onlineId, avatars, presence, trophySummary
  │
  ├──► games ──► titleId, concept (genres, media), playtime, dates
  │
  ├──► recent ──► lightweight recently played (no playtime)
  │
  ├──► titles ──► npCommunicationId + progress + lastUpdatedDateTime
  │     │
  │     └──► trophies ──► full trophy list per game
  │
  └──► trophymap ──► titleId → npCommunicationId (bridge for trophies)
```

**For sync**: `titles` is the incremental entry point. Compare `lastUpdatedDateTime` against stored value. If changed → call `trophies` for that game. `games` provides playtime/playcount when you need it. `recent` is even lighter for just "was this played?" checks.

---

## Steam (`api/steam.js`)

Account: **xoura** — 79 games, created Sep 2014

### `profile`

**Request**: `{ steamId: "76561198155573861" }`

```json
{
  "response": {
    "players": [
      {
        "steamid": "76561198155573861",
        "personaname": "xoura",
        "realname": "Moura",
        "profileurl": "https://steamcommunity.com/id/xoura07/",
        "avatar": "https://avatars.steamstatic.com/1bcf...08.jpg",
        "avatarmedium": "https://avatars.steamstatic.com/1bcf..._medium.jpg",
        "avatarfull": "https://avatars.steamstatic.com/1bcf..._full.jpg",
        "communityvisibilitystate": 3,
        "personastate": 0,
        "lastlogoff": 1781134277,
        "timecreated": 1411322759,
        "primaryclanid": "103582791429521408"
      }
    ]
  }
}
```

**Key observations**:
- `steamid` is a 17-digit numeric string (community ID)
- `personastate`: 0 = offline, 1 = online, 2 = busy, 3 = away, 4 = snooze, 5 = looking to trade, 6 = looking to play
- `communityvisibilitystate`: 1 = private, 3 = public
- `timecreated` is unix timestamp (1411322759 = 22 Sep 2014)
- `lastlogoff` is unix timestamp
- No banner/background image, no level, no game count in profile response
- Avatars: 3 sizes — `avatar` (small), `avatarmedium`, `avatarfull`

---

### `games`

**Request**: `{ steamId: "76561198155573861" }`

```json
{
  "response": {
    "game_count": 79,
    "games": [
      {
        "appid": 550,
        "name": "Left 4 Dead 2",
        "playtime_forever": 230,
        "playtime_windows_forever": 230,
        "playtime_mac_forever": 0,
        "playtime_linux_forever": 0,
        "playtime_deck_forever": 0,
        "playtime_disconnected": 0,
        "rtime_last_played": 1654365200,
        "img_icon_url": "hash",
        "has_community_visible_stats": true,
        "content_descriptorids": [2, 5]
      }
    ]
  }
}
```

**Key observations**:
- `playtime_forever` is in **minutes** (not ISO 8601 like PSN)
- `rtime_last_played`: unix timestamp, **0** = never launched
- `playtime_disconnected`: minutes where the game ran offline (no Steam tracking)
- `has_community_visible_stats`: true/false — indicates if game has achievements/stats
- `content_descriptorids`: content warning flags (e.g. blood, violence)
- Icon URL construction: `https://media.steampowered.com/steamcommunity/public/images/apps/{appid}/{img_icon_url}.jpg`
- No `playCount` field (unlike PSN)

**Top games by playtime**:

| # | Game | Minutes | Hours |
|---|---|---|---|
| 1 | Counter-Strike 2 | 95,079 | ~1,584h |
| 2 | Marvel Rivals | 14,400 | ~240h |
| 3 | Palworld | 8,561 | ~142h |
| 4 | MARVEL SNAP | 8,021 | ~133h |
| 5 | Apex Legends | 6,525 | ~108h |
| 6 | Brawlhalla | 4,663 | ~77h |
| 7 | Balatro | 4,219 | ~70h |
| 8 | MyDockFinder | 4,216 | ~70h |
| 9 | eFootball PES 2020 | 4,080 | ~68h |
| 10 | EA SPORTS FIFA 21 | 3,443 | ~57h |

---

### `recent`

**Request**: `{ steamId: "76561198155573861", count: 3 }`

```json
{
  "response": {
    "total_count": 3,
    "games": [
      {
        "appid": 1997040,
        "name": "MARVEL SNAP",
        "playtime_2weeks": 96,
        "playtime_forever": 8021,
        "img_icon_url": "ac70da51184b62607a88b9bd33cef0fab6aa2ebc"
      }
    ]
  }
}
```

**Key observations**:
- Same fields as `games` but adds `playtime_2weeks` (minutes in last 2 weeks)
- No `rtime_last_played` field (unlike `games`)
- Lightweight — no store metadata, no screenshots
- `total_count` is the actual count (not a total in the system)
- Only shows games played in the last 2 weeks

---

### `game`

**Request**: `{ appids: [730] }`

```json
{
  "730": {
    "success": true,
    "data": {
      "type": "game",
      "name": "Counter-Strike 2",
      "steam_appid": 730,
      "is_free": true,
      "developers": ["Valve"],
      "publishers": ["Valve"],
      "genres": [{ "id": "1", "description": "Action" }, { "id": "9", "description": "Free To Play" }],
      "categories": [{ "id": 1, "description": "Multi-player" }, ...],
      "header_image": "https://shared.akamai.steamstatic.com/.../header.jpg",
      "background": "https://store.akamai.steamstatic.com/...",
      "screenshots": [{ "id": 0, "path_thumbnail": "...", "path_full": "..." }],
      "release_date": { "coming_soon": false, "date": "21 Aug, 2012" },
      "platforms": { "windows": true, "mac": false, "linux": true },
      "metacritic": null,
      "short_description": "For over two decades, Counter-Strike...",
      "supported_languages": "...",
      "pc_requirements": { "minimum": "...", "recommended": "..." },
      "achievements": { "total": 1, "highlighted": [...] }
    }
  }
}
```

**Key observations**:
- Very rich — full store listing with descriptions (HTML), screenshots, videos
- `is_free`: boolean — helpful for filtering
- `developers` / `publishers`: arrays of strings
- `genres`: array of `{ id, description }` objects
- `screenshots`: array of `{ id, path_thumbnail, path_full }` — note: thumbnails are lower res, `path_full` is the original
- `header_image`: main store capsule (460×215, jpg)
- `background`: full-width background for store page
- `achievements.total`: count only (use `schemas` for actual definitions)
- No `short_description` in PSN equivalent — this is unique to Steam

---

### `schemas`

**Request**: `{ appid: 730 }`

```json
{
  "game": {
    "gameName": "Counter-Strike 2",
    "gameVersion": "247",
    "availableGameStats": {
      "achievements": [
        {
          "name": "PLAY_CS2",
          "defaultvalue": 0,
          "displayName": "A New Beginning",
          "hidden": 0,
          "description": "",
          "icon": "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/730/...jpg",
          "icongray": "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/730/...jpg"
        }
      ],
      "stats": [
        {
          "name": "total_kills_awp",
          "defaultvalue": 0,
          "displayName": "AWP Kills"
        }
      ]
    }
  }
}
```

**Key observations**:
- `achievements[]`: definitions — `name` (API key), `displayName` (localized), `icon`/`icongray`, `hidden` flag, `description`
- `stats[]`: separate from achievements — numerical tracking stats
- CS2 has only **1** achievement (PLAY_CS2) — old CS:GO achievements were removed during Source 2 migration. Most games have more.
- `gameName` may differ from store name (`ValveTestApp260` in some cases)
- Not all games have achievements — MARVEL SNAP returned 0 achievements

---

### `achievements`

**Request**: `{ steamId: "76561198155573861", appid: 730 }`

```json
{
  "playerstats": {
    "steamID": "76561198155573861",
    "gameName": "Counter-Strike 2",
    "achievements": [
      {
        "apiname": "PLAY_CS2",
        "achieved": 1,
        "unlocktime": 1665014400
      }
    ]
  }
}
```

**Key observations**:
- `apiname`: matches `name` in `schemas` response — use as join key
- `achieved`: 1 = earned, 0 = not earned
- `unlocktime`: unix timestamp, `0` if not earned
- No description, icon, or hidden flag — that data is in `schemas`
- Must **merge** `schemas` (definitions with icons/descriptions) + `achievements` (earned status) client-side
- Some games return `error: "Requested app has no stats"` — handle gracefully

---

### Steam Data Flow

```
steamId (public info)
  │
  ├──► profile ──► personaname, avatar, profile URL
  │
  ├──► games ──► full library (appid, name, playtime, last_played)
  │
  ├──► recent ──► last 2 weeks (includes playtime_2weeks)
  │
  ├──► game ──► store metadata (dev, publisher, genres, screenshots, desc)
  │
  ├──► schemas ──► achievement definitions (name, displayName, icon, hidden)
  │
  └──► achievements ──► earned status per player (achieved, unlocktime)
```

**For sync**: `games` is the primary entry point (full library + playtime). `recent` adds 2-week delta. `game` provides metadata. Merge `schemas` + `achievements` for full trophy/achievement picture.

---

## Epic (`api/epic.js`)

Account: **xoura07** — 73 library items, 18 games with achievements

### `auth`

**Request**: `{ authorizationCode }` or `{ refreshToken }`

```json
{
  "access_token": "eg1~JWT (36h expiry)",
  "expires_in": 129600,
  "expires_at": "2026-06-14T01:43:10.596Z",
  "token_type": "bearer",
  "refresh_token": "eg1~JWT (365d expiry)",
  "refresh_expires": 31540000,
  "refresh_expires_at": "2027-06-12T14:49:50.598Z",
  "account_id": "ae6eef67ad8e4cfbbff4ab6f27f6a893",
  "displayName": "xoura07",
  "country": "PT",
  "device_id": "545cd1e0ec654b30bcd7ef2603cfedcc"
}
```

**Key observations**:
- Both `access_token` and `refresh_token` are JWT format (`eg1~...`)
- Access token lasts **36 hours** (much longer than PSN's 1h)
- Refresh token lasts **365 days**
- `account_id` is a UUID-like string — needed for other endpoints
- `displayName` is the Epic display name
- `country` is set to PT

---

### `library`

**Request**: `{ accessToken }` + optional `{ resolveNames: true }`

```json
{
  "records": [
    {
      "namespace": "f4a904fcef2447439c35c4e6457f3027",
      "catalogItemId": "761fe09295aa422e8199cebaacf51675",
      "sandboxName": "Death Stranding",
      "appName": "Boga",
      "productId": "da519d41698b4854815db7371210c3a1",
      "sandboxType": "PUBLIC",
      "acquisitionDate": "2023-05-19T00:58:41.416Z",
      "platforms": ["Windows"]
    },
    {
      "namespace": "fn",
      "catalogItemId": "4fe75bbc5a674f4f9b356b5c90567da5",
      "sandboxName": "Fortnite",
      "appName": "Fortnite",
      "productId": "...",
      "sandboxType": "PUBLIC",
      "acquisitionDate": "2017-07-21T...",
      "playtime": 1821881,
      "platforms": ["Windows", "Mac"]
    }
  ]
}
```

**Key observations**:
- Auto-paginates through all pages
- Playtime is in **seconds** (not minutes like Steam, not ISO 8601 like PSN)
- Top playtime: Fortnite (1,821,881s ≈ 506h), Rocket League (362,977s ≈ 100h), Rogue Company (42,898s)
- Deduplicates by namespace, splits multi-artifact entries (e.g. Fortnite base + Rocket Racing get separate entries under `fn`)
- `sandboxName` can be generic like `"Live"`, `"shoal Production"`, `"mistletoe Production"` for games not in catalog
- `resolveNames: true` calls `catalog` to replace generic names — works for catalog-published games
- `appName` is the internal codename used for playtime matching (see field identity guide below)

**Field identity guide**:

| Library field | Maps to | Used for |
|---|---|---|
| `namespace` | `sandboxId` in progress/achievements | Achievement queries |
| `catalogItemId` | `id` in catalog API | Store metadata queries |
| `sandboxName` | Human-readable title | Display in UI |
| `appName` | Internal codename (e.g. `"Sugar"`, `"Jackal"`) | Matches playtime `artifactId` |
| `productId` | `productId` in achievement schema | Internal Epic reference |

**Notable namespace → game mappings from this account**:

| Namespace | AppName | Game | Playtime (s) |
|---|---|---|---|
| `fn` | Fortnite | Fortnite | 1,821,881 |
| `9773aa1aa54f4f7b80e44bef04986cea` | Sugar | Rocket League | 362,977 |
| `50118b7f954e450f8823df1614b24e80` | 0a2d9f... | Fall Guys | 8,027 |
| `jackal` | Jackal | Dauntless | 5,700 |
| `933ada2ec45e4184ae840d64c99e0ba9` | Pewee | Rogue Company | 42,898 |
| `catnip` | Catnip | Borderlands 3 | 1,465 |
| `ark` | aafc587f... | Ark | 12,744 |
| `calluna` | Calluna | Control | — |
| `angelonia` | Angelonia | Watch Dogs 2 | — |
| `turtle` | Turtle | Maneater | — |
| `wombat` | Wombat | World War Z | — |
| `ue` | UE_5.0 / UE_4.25 | Unreal Engine | 1,284 / 189,497 |
| `cbd5b3d310a54b12bf3fe8c41994174f` | 602eb4ab... | Valorant | 57 |

---

### `catalog`

**Request**: `{ accessToken, items: [{ namespace, catalogItemId }] }`

```json
[
  {
    "id": "4fe75bbc5a674f4f9b356b5c90567da5",
    "namespace": "fn",
    "title": "Fortnite",
    "description": "Everything you love, all in Fortnite...",
    "developer": "Epic Games",
    "developerId": "o-aa83a0a9bc45e98c80c1b1c9d92e9e",
    "keyImages": [
      { "type": "Featured", "url": "https://cdn1.epicgames.com/..." },
      { "type": "AndroidIcon", "url": "https://cdn1.epicgames.com/..." }
    ],
    "releaseInfo": [
      {
        "appId": "Fortnite",
        "platform": ["Windows", "Mac", "Android"],
        "dateAdded": "2014-09-11T00:00:00.000Z"
      }
    ],
    "categories": [{ "path": "games" }]
  }
]
```

**Key observations**:
- Groups items by namespace for batched API calls
- `keyImages` types: `Featured`, `AndroidIcon`, `DieselStoreFrontTall`, `OfferImageWide`, etc.
- `releaseInfo` contains platform availability and add date
- Returns full store metadata: `title`, `description` (HTML), `developer`, `categories`
- Requires `catalogItemId` from library — not all library entries have one
- Used implicitly by `library({ resolveNames: true })` and `progress({ resolveNames: true })`

---

### `progress`

**Request**: `{ accessToken }` + optional `{ resolveNames, sandboxIds[], names{} }`

```json
[
  {
    "sandboxId": "jackal",
    "productId": "prod-dauntless",
    "sandboxName": "Dauntless",
    "catalogItemId": null,
    "totalAchievements": 46,
    "totalXP": 2000,
    "totalUnlocked": 0,
    "earnedXP": 0,
    "achievementSets": [
      {
        "achievementSetId": "10678mh",
        "isBase": true,
        "totalAchievements": 10,
        "totalXP": 1000,
        "totalUnlocked": 0,
        "earnedXP": 0
      },
      {
        "achievementSetId": "2bhh595",
        "isBase": false,
        "totalAchievements": 36,
        "totalXP": 1000,
        "totalUnlocked": 0,
        "earnedXP": 0
      }
    ]
  }
]
```

**Key observations**:
- 18 games have achievements out of 73 library entries
- Auto-scans full library if `sandboxIds` not provided
- Achievement sets: base game (`isBase: true`) + DLC / expansion sets
- Player data merged in: `totalUnlocked` + `earnedXP` per set
- `resolveNames: true` fills in `sandboxName` via catalog API
- Only returns games with `totalAchievements > 0`

**Games on this account with achievements (top 5):**

| Sandbox | Game | Achievements | Unlocked | XP |
|---|---|---|---|---|
| `f4a904fcef2447439c35c4e6457f3027` | Death Stranding | 63 | 0/63 | 0/1000 |
| `9773aa1aa54f4f7b80e44bef04986cea` | Rocket League | 88 | 53/88 | 590/1000 |
| `jackal` | Dauntless | 46 | 0/46 | 0/2000 |
| `catnip` | Borderlands 3 | 20 | 0/20 | 0/1000 |
| `2c42520d342a46d7a6e0cfa77b4715de` | Dying Light | 78 | 0/78 | 0/1000 |

---

### `achievements`

**Request**: `{ accessToken, sandboxId }` + optional `{ sandboxName, catalogItemId }`

```json
{
  "sandboxId": "jackal",
  "productId": "prod-dauntless",
  "sandboxName": "Dauntless",
  "catalogItemId": null,
  "totalAchievements": 46,
  "totalXP": 2000,
  "totalUnlocked": 0,
  "earnedXP": 0,
  "achievementSets": [
    {
      "achievementSetId": "10678mh",
      "isBase": true,
      "totalAchievements": 10,
      "totalXP": 1000,
      "totalUnlocked": 0,
      "earnedXP": 0
    }
  ],
  "achievements": [
    {
      "name": "Expansion_Antidote",
      "displayName": "I Have The Antidote",
      "displayNameLocked": null,
      "iconUnlocked": "https://shared-static-prod.epicgames.com/epic-achievements/...",
      "iconLocked": "https://shared-static-prod.epicgames.com/epic-achievements/...",
      "XP": 20,
      "rarity": 9,
      "unlocked": false,
      "unlockDate": null,
      "achievementSetId": "2bhh595",
      "isBase": false
    }
  ]
}
```

**Key observations**:
- Merges schema definitions + player data in one response (both from GraphQL, parallel requests)
- `rarity` is a percentage (e.g. `9` = 9% of players earned it)
- `XP` per achievement, summed to `totalXP`
- Different icons for unlocked vs locked (`iconUnlocked` / `iconLocked`)
- `displayNameLocked` can be `null` — hidden achievement title
- Only games with achievements on the `progress` list will return data here
- `achievementSetId` ties each achievement to its set (base or DLC)

---

### Epic Data Flow

```
auth ──► access_token + refresh_token (36h / 365d)
  │
  ├──► library ──► namespace, catalogItemId, sandboxName, appName, playtime (seconds)
  │     │
  │     └──► catalog ──► title, description, developer, keyImages, releaseInfo
  │
  └──► progress ──► games with achievements + progress summary
        │
        └──► achievements ──► full details per game (icons, XP, rarity, earned)
```

**For sync**: `library` is the entry point. `progress` with `resolveNames: true` scans all namespaces for achievement schemas. `achievements` gets full details per game. Playtime is in seconds — compare against previous run for incremental detection (no "last played" timestamp exists in Epic's API). `catalogItemId` + `namespace` from library records serve as the lookup keys for `catalog` queries.

---

## EA (`api/ea.js`)

Account: **fssmoura7** — 7 games

### `auth`

**Request**: `{ accessToken }`

```json
{
  "accessToken": "QVQwOjMuMDozLjA6MjQwOjRSbjdJUUVVTlJFN0lYdUo0NTZ5bldlWFZDak1lRUp4RXQzOjUyMzI4OnNhMDFy",
  "pidId": "1000668252328",
  "personaId": "1114884390",
  "displayName": "fssmoura7"
}
```

**Key observations**:
- Takes the raw `access_token` from the EA implicit grant URL — no exchange flow
- `personaId` is required for the `achievements` action
- Token expires in ~4 hours (14,399s), **no refresh flow available** — user revisits auth URL
- `pidId` is the EA player ID, `personaId` is the platform-specific persona

---

### `library`

**Request**: `{ accessToken }`

```json
{
  "records": [
    {
      "originOfferId": "offer-8a172204-3e5a-4325-820a-e4a2c41cdb39",
      "productId": "prod-1003-cfea34b7-0d68-410b-9173-5d7e6800b6d2",
      "name": "Need for Speed™ Heat",
      "gameSlug": "need-for-speed-heat",
      "contentId": "1005-cfea34b7-0d68-410b-9173-5d7e6800b6d2",
      "displayType": "FULL_GAME",
      "achievementSetOverride": "50317_195133_50844",
      "playtimeSeconds": 116315,
      "lastPlayedDate": "1970-01-01T00:00:00.000Z"
    }
  ]
}
```

**Key observations**:
- 7 games owned on EA (Origin desktop app)
- Playtime in **seconds** (like Epic)
- `gameSlug` is the URL-friendly name used for playtime lookups
- `achievementSetOverride` is `null` for games without achievements (e.g. The Sims 4)
- `lastPlayedDate` is `1970-01-01` for most games — EA resets timestamps for games not played recently (or this is a bug in the API)
- Three GraphQL queries fire sequentially: entitlements → recentGames (playtime) → legacyOffers (metadata)

**Full library:**

| Name | Slug | Playtime (s) | Hours | Achievement Set | Last Played |
|---|---|---|---|---|---|
| Need for Speed™ Heat | need-for-speed-heat | 116,315 | ~32h | `50317_195133_50844` | 1970-01-01 |
| EA SPORTS™ FIFA 20 | fifa-20 | 904,685 | ~251h | `50072_194927_50844` | 2020-10-20 |
| The Sims™ 4 | the-sims-4 | 5,247 | ~1.5h | (null) | 1970-01-01 |
| Apex Legends™ | apex-legends | 9,059 | ~2.5h | `193634_194908_50844` | 1970-01-01 |
| STAR WARS™ Battlefront™ II | star-wars-battlefront-2 | 75,184 | ~21h | `75158_193864_50844` | 1970-01-01 |
| FIFA 19 | fifa-19 | 1,027,878 | ~285h | `50072_193612_50844` | 1970-01-01 |
| FIFA 18 | fifa-18 | 1,811,150 | ~503h | `50072_193608_50844` | 1970-01-01 |

**Field identity guide**:

| Library field | Maps to | Used for |
|---|---|---|
| `originOfferId` | Offer lookup key | Legacy offers & metadata |
| `gameSlug` | URL slug | Playtime queries |
| `achievementSetOverride` | Achievement set ID | Achievements query (null = no achievements) |
| `contentId` | Master title ID | Internal EA reference |
| `personaId` | Player persona ID | Achievements query (from auth) |

---

### `achievements`

**Request**: `{ accessToken, personaId, achievementSetOverride }` + optional `{ sandboxName }`

Has **two tiers** depending on whether the legacy REST API has data for the given achievement set:

**Tier 1 — Legacy REST API** (older Origin-era games: FIFA 19 and before):

```json
{
  "sandboxName": "FIFA 19",
  "achievementSetId": "50072_193612_50844",
  "totalAchievements": 22,
  "totalUnlocked": 22,
  "achievements": [
    {
      "id": "1",
      "name": "The Historian",
      "description": "Score a left foot volley against Coventry City in The Journey",
      "howTo": "Score a left foot volley against Coventry City in The Journey",
      "xp": 15,
      "hidden": false,
      "rarity": 30.92,
      "iconUrl": "https://achievements.gameservices.ea.com/achievements/icons/50072_193612_50844-1-208.png",
      "unlocked": true,
      "unlockDate": "2019-08-13T23:04:45.000Z"
    }
  ]
}
```

**Tier 2 — GraphQL fallback** (newer games: FIFA 20, NFS Heat, Apex Legends):

```json
{
  "sandboxName": "Need for Speed Heat",
  "achievementSetId": "50317_195133_50844",
  "totalAchievements": 42,
  "totalUnlocked": 16,
  "achievements": [
    {
      "id": "4",
      "name": "Home from Home",
      "unlocked": true,
      "unlockDate": "2020-02-10T16:02:41.000Z"
    }
  ]
}
```

**Key observations**:
- Handler tries legacy REST API first — if the achievement set ID exists there, returns rich data
- Falls back to GraphQL if legacy API doesn't have the set — returns minimal data
- **Rich data fields**: `description`, `howTo`, `xp`, `hidden`, `rarity` (global %), `iconUrl`, `unlocked`, `unlockDate`
- **Minimal data fields**: `id`, `name`, `unlocked`, `unlockDate`
- The cutoff is roughly **2020** — older Origin-era games have legacy data, newer games use GraphQL only

**Achievement data quality by game on this account:**

| Game | Rich? | Total | Unlocked | Notes |
|---|---|---|---|---|
| FIFA 18 | ✅ Legacy | ? | ? | Not directly tested, likely rich |
| FIFA 19 | ✅ Legacy | 22 | 22 | Icons, descriptions, rarity, XP all present |
| FIFA 20 | ❌ GraphQL | 31 | 15 | Name + status only |
| NFS Heat | ❌ GraphQL | 42 | 16 | Name + status only |
| Apex Legends | ? | ? | ? | Live service, likely GraphQL |
| Battlefront II | ? | ? | ? | 2017 game, could go either way |

---

### EA Data Flow

```
auth ──► accessToken (4h expiry, no refresh)
  │
  ├──► library ──► game list + playtime (seconds) + achievement set IDs
  │
  └──► achievements ──► per-game details
        │
        ├── Legacy REST (older games) ──► icons, descriptions, rarity, XP
        └── GraphQL (newer games) ────► name + status only
```

**For sync**: `library` is the entry point. Compare `playtimeSeconds` against previous run for incremental detection (lastPlayedDate is unreliable). Each record includes `achievementSetOverride` — `null` means no achievements exist. Achievements data quality varies by game age: pre-2020 games get full details, post-2020 games get minimal data.

---

## Xbox (`api/xbox.js`)

Account: **xoura7** — 56 titles tracked, 235 Gamerscore

### `auth`

**Request**: `{ authorizationCode }` or `{ refreshToken }`

```json
{
  "xuid": "2535458901403801",
  "gamertag": "xoura7",
  "userHash": "11994374835125445724",
  "xstsToken": "JWT (XSTS)",
  "accessToken": "MSA access token (1h expiry)",
  "refreshToken": "M.C522_BAY.0.U... (MSA refresh token)",
  "expiresIn": 3600
}
```

**Key observations**:
- Full OAuth 2.0 chain: `authorizationCode → MSA token → User token → XSTS token`
- `xuid` is the Xbox User ID (numeric, ~16 digits)
- `userHash` + `xstsToken` form the `XBL3.0 x={userHash};{xstsToken}` auth header needed for all subsequent calls
- `refreshToken` is a Microsoft account refresh token (not a JWT like Epic)
- Access token expires in 1 hour (3600s)

---

### `profile`

**Request**: `{ xuid, userHash, xstsToken }`

```json
{
  "profileUsers": [
    {
      "id": "2535458901403801",
      "hostId": "2535458901403801",
      "settings": [
        { "id": "GameDisplayName", "value": "xoura7" },
        { "id": "GameDisplayPicRaw", "value": "https://images-eds-ssl.xboxlive.com/image?url=..." },
        { "id": "Gamerscore", "value": "235" },
        { "id": "Gamertag", "value": "xoura7" }
      ],
      "isSponsoredUser": false
    }
  ]
}
```

**Key observations**:
- Only 4 settings requested: `GameDisplayName`, `GameDisplayPicRaw`, `Gamerscore`, `Gamertag`
- `Gamerscore` is total across all games (235)
- Profile picture is a URL from Xbox CDN

---

### `games`

**Request**: `{ xuid, userHash, xstsToken }`

```json
{
  "titles": [
    {
      "titleId": 1820250788,
      "name": "Fortnite",
      "titleType": "XboxTitleHistory",
      "titleHistory": {
        "lastTimePlayed": "2026-06-05T15:05:12.8230000Z",
        "devices": ["XboxSeries"]
      },
      "detail": {
        "developerName": "Epic Games",
        "publisherName": "Epic Games",
        "displayImage": "https://images-eds-ssl.xboxlive.com/image?url=...",
        "description": "string",
        "shortDescription": "...",
        "genres": ["Action"],
        "attributes": []
      }
    }
  ]
}
```

**Key observations**:
- **56 titles** tracked (only games started at least once — no full purchase library)
- `lastTimePlayed` is ISO 8601 datetime
- MinutesPlayed merged from `userstats.xboxlive.com/batch` — only available for Microsoft Store/Xbox-native titles (UWP, Game Pass)
- Most games show `minutesPlayed: 0` or `null` (non-MS games like Steam titles that appear via Xbox app tracking on PC)
- Games with playtime data on this account: Minecraft Dungeons (679 min), Forza Horizon 5 (294 min), Halo Infinite (56 min), Minecraft Launcher (0 min), Microsoft Solitaire Collection (0 min)
- `detail` includes: `developerName`, `publisherName`, `description`, `shortDescription`, `releaseDate`, `genres`, `displayImage`
- `devices` in titleHistory: `XboxSeries`, `XboxOne`, `PC`, `Mobile`, etc.
- No separate catalog endpoint — metadata is inline in the games response

**Full title list (56 total, sorted by last played):**

| Game | Last Played | Minutes | Developer |
|---|---|---|---|
| Fortnite | 2026-06-05 | — | Epic Games |
| Rocket League | 2026-05-31 | — | Psyonix |
| League of Legends | 2026-03-23 | — | Riot Games |
| Among Us | 2026-01-10 | — | Innersloth |
| Minecraft Launcher | 2025-12-28 | 0 | Mojang/Microsoft |
| Minecraft | 2025-12-28 | — | Mojang AB |
| Osu! | 2025-12-27 | — | ppy |
| Risk of Rain 2 | 2025-09-16 | — | Hopoo Games |
| Minecraft Dungeons | 2023-03-26 | 679 | Mojang Studios |
| Forza Horizon 5 | 2022-09-12 | 294 | Playground Games |
| Halo Infinite | 2022-07-25 | 56 | 343 Industries |
| ... (45 more) | | | |

---

### `achievements`

**Request**: `{ xuid, userHash, xstsToken, titleId }`

```json
{
  "achievements": [
    {
      "id": "1",
      "serviceConfigId": "00000000-0000-0000-0000-00007900c3c7",
      "name": "Welcome to México",
      "progressState": "Achieved",
      "progression": {
        "requirements": [],
        "timeUnlocked": "2022-09-09T19:57:50.1330000Z"
      },
      "mediaAssets": [
        {
          "name": "882dc700-...",
          "type": "Icon",
          "url": "https://images-eds-ssl.xboxlive.com/image?url=..."
        }
      ],
      "platforms": ["XboxOne"],
      "isSecret": false,
      "description": "Arrive at Horizon Festival México",
      "lockedDescription": "Arrive at Horizon Festival México",
      "achievementType": "Persistent",
      "participationType": "Individual",
      "rewards": [
        {
          "value": "10",
          "type": "Gamerscore"
        }
      ],
      "isRevoked": false
    }
  ]
}
```

**Key observations**:
- `progressState`: `"Achieved"` or `"NotAchieved"` (not boolean like other platforms)
- `rewards[].value`: gamerscore per achievement
- `rewards[].type`: always `"Gamerscore"`
- `timeUnlocked`: ISO 8601 datetime, `0001-01-01T00:00:00` if not earned
- `isSecret`: boolean — hidden achievement
- `mediaAssets[].url`: achievement icon
- `description` / `lockedDescription`: same text (no hidden description trick like PSN's unearned display)
- `platforms`: which platform the achievement was unlocked on
- `maxItems=1000` is the request limit — should cover all games

**Tested games:**

| Game | titleId | Achievements | Earned |
|---|---|---|---|
| Minecraft Dungeons | 1739375565 | 104 | 10 |
| Forza Horizon 5 | 2030093255 | 164 | 3 |

---

### Xbox Data Flow

```
auth ──► xuid + userHash + xstsToken + refreshToken (1h expiry)
  │
  ├──► profile ──► gamertag, gamerscore, avatar URL
  │
  ├──► games ──► title history + metadata + playtime (minutes)
  │
  └──► achievements ──► per-game list (gamerscore, description, icon, earned status)
```

**For sync**: `games` is the entry point. Compare `lastTimePlayed` against stored timestamps. Titles where it's newer need re-import. Only MS/Xbox-native titles have playtime data and achievements. Games with `null` or old timestamps can be skipped.

---

## IGDB (`api/igdb.js`)

Uses IGDB v4 (Twitch-backed game database). No user auth — Twitch Client ID + Client Secret are server-side env vars. Token auto-refreshes in-memory.

### `auth`

**Request**: nothing

```json
{
  "accessToken": "Twitch OAuth JWT (~60d expiry)",
  "expiresAt": 1747600000
}
```

No user-facing account — this is an app-level token for API access.

---

### `search`

**Request**: `{ query: "Elden Ring", limit: 10, type: 0 }`

```json
[
  {
    "id": 112,
    "name": "Elden Ring",
    "slug": "elden-ring",
    "summary": "The Golden Order has been broken...",
    "game_type": 0,
    "cover": {
      "url": "https://images.igdb.com/igdb/image/upload/t_1080p/co4jni.jpg"
    },
    "platforms": [
      { "id": 6, "name": "PC (Microsoft Windows)", "abbreviation": "PC" },
      { "id": 48, "name": "PlayStation 4", "abbreviation": "PS4" },
      { "id": 49, "name": "PlayStation 5", "abbreviation": "PS5" },
      { "id": 32, "name": "Xbox One", "abbreviation": "XOne" },
      { "id": 169, "name": "Xbox Series X|S", "abbreviation": "XSXS" }
    ],
    "release_dates": [
      { "date": 1645660800, "platform": 6, "region": 8, "human": "Feb 24, 2022" }
    ]
  }
]
```

**Key observations**:
- `type` param filters by `game_type` enum (0 = main_game) — use to exclude DLCs, bundles, etc
- `limit` defaults to 10
- Cover images always `t_1080p` — replace size in URL for smaller variants
- `release_dates[].date` is unix timestamp — earliest date is the first release
- `region`: 1 = US, 2 = EU, 8 = WW (worldwide)

---

### `game`

**Request**: `{ ids: [112] }`

```json
{
  "id": 112,
  "name": "Elden Ring",
  "slug": "elden-ring",
  "summary": "The Golden Order has been broken...",
  "storyline": "Rise, Tarnished, and be guided by grace...",
  "game_type": 0,
  "version_title": null,
  "rating": 95.0,
  "rating_count": 4321,
  "updated_at": 1747000000,
  "cover": { "url": "https://images.igdb.com/igdb/image/upload/t_1080p/co4jni.jpg" },
  "screenshots": [{ "url": "https://images.igdb.com/igdb/image/upload/t_1080p/sc52we.jpg" }],
  "artworks": [{ "url": "..." }],
  "videos": [{ "name": "Story Trailer", "url": "https://www.youtube.com/watch?v=K_03kFqW8I" }],
  "genres": [{ "id": 12, "name": "Role-playing (RPG)" }, { "id": 31, "name": "Adventure" }],
  "platforms": [{ "id": 6, "name": "PC (Microsoft Windows)", "abbreviation": "PC" }],
  "involved_companies": [
    { "id": 1, "company": { "id": 100, "name": "FromSoftware" }, "developer": true, "publisher": false }
  ],
  "release_dates": [{ "id": 1, "date": 1645660800, "platform": 6, "region": 8, "human": "Feb 24, 2022" }],
  "websites": [{ "url": "https://www.eldenring.com", "type": 1 }],
  "collections": [{ "id": 100, "name": "Souls series" }],
  "franchise": { "id": 100, "name": "Dark Souls" },
  "parent_game": null,
  "version_parent": null,
  "bundles": [],
  "dlcs": [109421],
  "expanded_games": [],
  "expansions": [],
  "forks": [],
  "ports": [],
  "remakes": [],
  "remasters": [],
  "standalone_expansions": [],
  "similar_games": [120, 130, 140]
}
```

**Key observations**:
- `websites[].type`: 1 = Official, 3 = Wikipedia, 9 = YouTube, 13 = Steam, 16 = Epic
- `game_type`: 0 = main_game, 1 = dlc_addon, 3 = bundle, 8 = remake, 9 = remaster, etc (see full table below)
- `rating` is 0–100, `rating_count` is number of community ratings
- `version_title` is non-null for editions (e.g. "Game of the Year Edition")
- Relationships are directional — `parent_game`/`version_parent` have full names; bare ID lists for children (`dlcs`, `bundles`, etc)
- Editions and updates NOT returned by parent — query `where version_parent = {id}` for editions, `where parent_game = {id} & game_type = 14` for updates
- Image URL: `https://images.igdb.com/igdb/image/upload/t_1080p/{image_id}.jpg`
- Video URL: `https://www.youtube.com/watch?v={video_id}`

### Game type enum

| Value | Name |
| ----- | ---- |
| 0 | main_game |
| 1 | dlc_addon |
| 2 | expansion |
| 3 | bundle |
| 4 | standalone_expansion |
| 5 | mod |
| 6 | episode |
| 7 | season |
| 8 | remake |
| 9 | remaster |
| 10 | expanded_game |
| 11 | port |
| 12 | fork |
| 13 | pack |
| 14 | update |

---

### `by_external`

**Request**: `{ source: "steam", uid: "730" }` or `{ source: "psn", uid: "10011898" }`

```json
{
  "id": 112,
  "name": "Elden Ring",
  "slug": "elden-ring",
  "game_type": 0,
  "cover": { "url": "..." }
}
```

Or `null` if no match.

**Key observations**:
- Uses IGDB's `external_game_source` table (not deprecated `category` field)
- Source map: `steam` = 1, `gog` = 5, `xbox` = 31, `psn` = 36, `epic` = 26
- Returns same fields as `game` — full record
- `null` means IGDB has no record for that external ID (common for Epic UUIDs, modern Xbox titleIds)
- Returns at most 1 result

---

### `external_ids`

**Request**: `{ ids: 112 }` or `{ ids: [112, 353848] }`

Single ID:

```json
{
  "steam": { "uid": "1245620", "url": "https://www.igdb.com/games/elden-ring/external/steam-1245620" },
  "psn": { "uid": "10011898", "url": "https://www.igdb.com/games/elden-ring/external/psn-10011898" },
  "xbox": { "uid": "66acd000-...", "url": "..." },
  "epic": { "uid": "...
  "gog": { "uid": "...", "url": "..." }
}
```

Multiple IDs:

```json
{
  "112": { "steam": { "uid": "1245620" } },
  "353848": { "steam": { "uid": "3405690" }, "psn": { "uid": "10011898" } }
}
```

**Key observations**:
- Known sources get named keys (`steam`, `psn`, `xbox`, `epic`, `gog`); unknown sources get `source_<N>` (e.g. `source_42`)
- Multiple IDs return an object keyed by IGDB ID — same shape per entry
- Essential bridge: get Steam appid from IGDB game ID → use for SGDB art lookups
- Not all platforms resolve — Epic UUIDs and modern Xbox titleIds are typically absent

---

### IGDB ID mapping (verified against live data)

| Platform | Platform's own ID | IGDB uid format | Direct bridge? | How |
|----------|-------------------|-----------------|:--------------:|-----|
| **PSN** | `concept.id` from `psn/games` (e.g. `10011898`) | Numeric string | ✅ 1:1 | PSN `games` → `by_external(psn, conceptId)` |
| **Steam** | `appid` from `steam/games` (e.g. `1245620`) | Numeric string | ✅ 1:1 | Steam `games` → `by_external(steam, appid)` |
| **Epic** | `namespace` / `catalogItemId` | Hex UUID (product slug, not namespace) | ❌ | Store URL slug differs from both identifiers |
| **Xbox** | `titleId` from `xbox/games` (e.g. `1820250788`) | Xbox 360 UUID format | ❌ | IGDB only has Xbox 360 marketplace IDs |
| **EA** | `contentId` from `ea/library` | N/A | ❌ | No EA/Origin source in IGDB |

**Rate limit**: 4 req/s to IGDB (handled server-side — no client throttle needed).

---

## SGDB (`api/sgdb.js`)

Uses SteamGridDB v2 API (community game art). Auth: static API key (`STEAMGRIDDB_API_KEY`), `Authorization: Bearer` header. No CORS headers — all requests proxy through Vercel.

### `search`

**Request**: `{ name: "Elden Ring" }`

Endpoint: `/search/autocomplete/{term}`
```json
[
  { "id": 5495669, "name": "Elden Ring", "release_date": 1645568013 }
]
```

**Key observations**:
- Uses `/search/autocomplete/` not `/search/` — returns partial matches
- `release_date` is unix timestamp
- Response is clean: id, name, release_date only (other SGDB fields stripped)

---

### `game`

**Request**: `{ sgdbId: 5495669 }` or `{ platform: "steam", platformId: 1245620 }`

```json
{ "id": 5495669, "name": "Elden Ring", "release_date": 1645568013 }
```

Or `null` if not found.

**Key observations**:
- Platform enum: `steam`, `origin`, `egs`, `bnet`, `uplay`, `flashpoint`, `eshop`
- Direct platform lookup works for Steam (`appid`), Epic (`namespace`) — others need IGDB bridge
- For PSN/Xbox: use IGDB `external_ids` → Steam appid → SGDB steam bridge
- Name search is final fallback for exclusives with no bridge

---

### `grids`

**Request**: `{ sgdbId: 5495669 }` or `{ platform: "steam", platformId: 1245620 }`

```json
{
  "page": 1,
  "total": 126,
  "limit": 100,
  "data": [
    {
      "id": 43851234,
      "width": 920,
      "height": 430,
      "nsfw": false,
      "humor": false,
      "mime": "image/webp",
      "url": "https://cdn2.steamgriddb.com/grid/...webp",
      "thumb": "https://cdn2.steamgriddb.com/grid/thumb/...webp"
    }
  ]
}
```

**Key observations**:
- Same shape for `heroes` and `logos` (logos have no `dimensions` filter)
- Default includes everything: nsfw=any, humor=any, epilepsy=any, all types, all styles
- Filters: `styles`, `dimensions`, `mimes`, `types` (static/animated), `nsfw` (yes/no/any), `humor`, `epilepsy`, `limit`, `page`
- Dimensions differ per asset type — see SGDB docs for valid values
- 920×430 seems to be the "Steam default" grid size
- Thumbnail URLs are in the same directory, just `thumb/` subpath

### Platform ID → SGDB bridge

| Source | Our ID | Direct? | Strategy |
|--------|--------|:-------:|----------|
| Steam | appid (int) | ✅ | `/grids/steam/{appid}` |
| Epic | namespace (string) | ✅ | `/grids/egs/{namespace}` |
| PSN | concept.id (int) | ❌ | IGDB `external_ids` → Steam appid → SGDB steam |
| Xbox | titleId (int) | ❌ | IGDB `external_ids` → Steam appid → SGDB steam |
| EA | contentId (string) | ❌ | Name search fallback |

**Caching**: Game lookups stable — cache aggressively. Assets cacheable with reasonable TTL. No documented rate limit.

---

## Sync workflow

The API supports two patterns:

**Initial sync** — pull everything once:

```
auth → profile → games (no limit) → titles (no limit) → trophies per game
```

**Incremental update** — only fetch what changed:

```
auth (via refreshToken) → recent({ limit: 20 }) → compare lastPlayedDateTime
                        → titles({ limit: 50 }) → compare lastUpdatedDateTime
                        → trophies only for changed titles
```

### Per-platform increments

**PSN**: `titles` is the incremental entry point. Compare `lastUpdatedDateTime` against stored value. If changed → call `trophies` for that game. `games` provides playtime/playcount when needed. `recent` is even lighter for "was this played?" checks.

**Steam**: `games` is the primary entry point (full library + playtime). `recent` adds 2-week delta. `game` provides metadata. Merge `schemas` + `achievements` for full trophy/achievement picture.

```
steamId → games → compare rtime_last_played → mark changed
        → achievements per changed game (merge with schemas)
```

**Epic**: `library` is the entry point. Compare `playtime` (no timestamp available) against previous run. `progress` with `resolveNames: true` scans all namespaces for achievement schemas. `achievements` gets full details per game.

```
auth → library({ resolveNames: true }) → compare acquisitionDate
     → catalog only for new/changed items
     → progress({ resolveNames: true }) → achievements only for games with new unlocks
```

**Xbox**: `games` is the entry point. Compare `lastTimePlayed` against stored timestamps. Titles where it's newer need re-import. Only MS/Xbox-native titles have playtime and achievements.

```
auth → profile → games → compare lastTimePlayed per title
                      → achievements only for titles where lastTimePlayed changed
```

**EA**: `library` is the entry point. Compare `playtimeSeconds` against previous run. `achievementSetOverride` = null means no achievements exist.

```
auth → library → compare playtime per game
               → achievements only for games with changed playtime
```

### IGDB + SGDB enrichment

After syncing any platform, enrich each game via IGDB:

```
platform game → IGDB by_external(platform, platformId) → store IGDB game ID (canonical)
             → IGDB external_ids(igdbId) → check for Steam appid
               → if found → SGDB game({ platform: "steam", platformId }) → SGDB ID
                          → SGDB grids/heroes/logos({ sgdbId }) → artwork
               → if not found → SGDB search(name) → pick match → artwork
```

---

## Cross-Platform Comparison

| Aspect | PSN | Steam | Epic | EA | Xbox |
|---|---|---|---|---|---|---|
| Playtime format | ISO 8601 (`PT106H56M38S`) | Minutes | Seconds | Seconds | Minutes (MS-native only) |
| Play count | `playCount` | Not available | Not available | Not available | Not available |
| Last played | ISO datetime | Unix timestamp | Not available | ISO (unreliable) | ISO datetime |
| Game ID | `titleId` | `appid` (int) | `namespace` | `originOfferId` | `titleId` (int) |
| Store metadata | In `games` | Separate `game` | Separate `catalog` | In `library` | In `games` response |
| Achievements total | `titles` | `game` | `progress` | In achievements | In achievements response |
| Achievement details | `trophies` (merged) | `schemas` + `achievements` | `achievements` (merged) | `achievements` (merged) | `achievements` (merged) |
| Rarity | `%` + tier 0/1/2 | Not available | `%` | `%` (legacy) | Not available |
| Trophy type | bronze/silver/gold/plat | N/A (all equal) | N/A (XP-based) | N/A (XP-based) | Gamerscore |
| Auth expiry | 1h / 10d refresh | Static API key | 36h / 365d refresh | 4h, no refresh | 1h / refresh available |
| Library size | 172 games | 79 games | 73 items | 7 games | 56 titles |

---

## Integration Notes

**Timestamps**: Five different formats across platforms:
- PSN: ISO 8601 datetime
- Steam: unix timestamp (`rtime_last_played`, 0 = never)
- Epic: no last-played timestamp
- EA: ISO datetime (but often returns `1970-01-01` — unreliable)
- Xbox: ISO 8601 datetime (`titleHistory.lastTimePlayed`)

**Playtime**: Five different formats:
- PSN: ISO 8601 duration (`PT106H56M38S`) → parse to hours/minutes
- Steam: minutes (integer) → pass through
- Epic: seconds (integer) → divide by 60 for minutes
- EA: seconds (integer) → divide by 60 for minutes
- Xbox: minutes (integer, MS-native titles only) — most games return null

**Achievements**:
- PSN: merges definitions+earned in one `trophies` call
- Steam: requires two calls (`schemas` + `achievements`) + client-side merge
- Epic: merges definitions+earned in one `achievements` call
- EA: merges in one call, but data quality varies (legacy API vs GraphQL fallback)
- Xbox: merges in one call — includes description, icon URL, gamerscore, progress state

**Incremental sync**:
- PSN: `titles` → compare `lastUpdatedDateTime` → `trophies` for changed games
- Steam: `games` → compare `rtime_last_played` → mark changed → `achievements` per changed game
- Epic: `library` → compare `playtime` (no timestamp) → `progress` → `achievements` for changed games
- EA: `library` → compare `playtimeSeconds` → `achievements` for games with changed playtime
- Xbox: `games` → compare `lastTimePlayed` → achievements only for changed titles

**Icon URLs**:
- PSN: absolute URLs in response
- Steam: `img_icon_url` hashes — construct URL
- Epic: absolute URLs (`shared-static-prod.epicgames.com/epic-achievements/...`)
- EA: absolute URLs (`achievements.gameservices.ea.com/achievements/icons/...`) — legacy only
- Xbox: absolute URLs (`images-eds-ssl.xboxlive.com/image?url=...`) — via `mediaAssets`

**Auth patterns**:
- PSN: NPSSO → access code → access token (1h) + refresh token (10d)
- Steam: static API key in server env var (never sent to client)
- Epic: authorization code → access token (36h) + refresh token (365d)
- EA: implicit grant → access token (4h), **no refresh available**
- Xbox: authorization code → MSA token → User token → XSTS token (1h, refresh available)

**Library granularity**:
- PSN: 172 games, 164 with trophies — includes PS+ titles
- Steam: 79 games — full purchase library (free games opt-in)
- Epic: 73 items — includes free claimed games + launcher/tools
- EA: 7 games — Origin purchases only
- Xbox: 56 titles — only started games (no full purchase library), mixes MS-native + Steam/standalone
