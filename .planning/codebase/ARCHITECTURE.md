# Architecture

**Analysis Date:** 2026-03-28

## Pattern Overview

**Overall:** Single-process Telegram bot with session-based state machine, grammY middleware pipeline, and Notion as the sole persistence layer.

**Key Characteristics:**
- Stateful conversation flow managed via grammY session middleware (in-memory, per-chat)
- Linear middleware pipeline: logging -> session -> owner guard -> handlers
- All content funnels through a single `processNewContent()` function before entering the state machine
- No database besides Notion; no local persistence of session state (lost on restart)

## Layers

**Entry Point / Bootstrap:**
- Purpose: Start the bot, register signal handlers
- Location: `src/index.ts`
- Contains: Bot startup, SIGINT/SIGTERM graceful shutdown
- Depends on: `src/bot.ts`

**Configuration:**
- Purpose: Load and validate environment variables, export typed constants
- Location: `src/config.ts`
- Contains: `required()` helper, all env var exports, `DEFAULT_HASHTAGS`, `OWNER_CHAT_ID`
- Depends on: `dotenv`, `.env` file
- Used by: Every other module

**Bot Core (Controller):**
- Purpose: All Telegram message handling, session state machine, middleware pipeline, orchestration
- Location: `src/bot.ts`
- Contains: Session interface, middleware chain, all message handlers, callback query handlers, `saveToNotion()` orchestrator
- Depends on: `src/config.ts`, `src/services/notion.ts`, `src/keyboards/hashtags.ts`, `src/utils/text-utils.ts`, `src/utils/content-hash.ts`
- Used by: `src/index.ts`

**Storage Service:**
- Purpose: Notion API operations (create pages, find duplicates)
- Location: `src/services/notion.ts`
- Contains: `createPage()`, `findDuplicate()`, `PageData` interface, `ContentType` type
- Depends on: `@notionhq/client`, `src/config.ts`, `src/utils/text-utils.ts`
- Used by: `src/bot.ts`

**UI (Keyboards):**
- Purpose: Build Telegram inline keyboards for user interaction
- Location: `src/keyboards/hashtags.ts`
- Contains: `buildCategoryKeyboard()`, `buildTitleKeyboard()`, `buildDuplicateKeyboard()`
- Depends on: `grammy` (InlineKeyboard), `src/config.ts` (DEFAULT_HASHTAGS)
- Used by: `src/bot.ts`

**Utilities:**
- Purpose: Pure functions for text processing and content hashing
- Location: `src/utils/text-utils.ts`, `src/utils/content-hash.ts`
- Contains: `splitText()`, `autoTitle()`, `detectVideoUrl()`, `contentHash()`, `urlNormalize()`
- Depends on: `node:crypto` only
- Used by: `src/bot.ts`, `src/services/notion.ts`

## Middleware Pipeline

The grammY middleware chain executes in this order for every update:

1. **Logging middleware** (line 53) - Logs update_id, from, chat, keys, text preview
2. **Session middleware** (line 65) - Injects `ctx.session` with `SessionData`
3. **Owner guard** (line 68) - Rejects non-owner users (checks `ctx.chat.id === OWNER_CHAT_ID`)
4. **Handler routing** - grammY routes to the matching handler:
   - `bot.command('start')` / `bot.command('cancel')`
   - `bot.on('message:text')` - text, forwarded text, video URLs
   - `bot.on('message:photo')` - photos with optional captions
   - `bot.on(['message:document', 'message:video', ...])` - documents, videos, audio, etc.
   - `bot.on('callback_query:data')` - inline keyboard callbacks
   - `bot.on('message')` - fallback for unhandled types

## Session State Machine

**States:** `idle` -> `awaiting_category` -> `awaiting_title` -> `idle`
                                         \-> `awaiting_custom_tag` -> `awaiting_category` (loops back)

**Interface:** `SessionData` in `src/bot.ts` (line 9)

```
idle
  |
  | (user sends content: text/photo/video/forward)
  v
  processNewContent()
  |
  |-- duplicate found? --> show dup keyboard
  |     |-- "dup:new"    --> awaiting_category
  |     |-- "dup:cancel" --> idle
  |
  |-- no duplicate --> awaiting_category (show category keyboard)

awaiting_category
  |
  |-- "cat:{tag}"   --> toggle tag, stay in awaiting_category
  |-- "cat:custom"  --> awaiting_custom_tag
  |-- "cat:save"    --> awaiting_title (show title keyboard)
  |-- "cat:cancel"  --> idle

awaiting_custom_tag
  |
  | (user types tag text)
  v
  awaiting_category (add tag, redisplay keyboard)

awaiting_title
  |
  |-- user types title text --> saveToNotion() --> idle
  |-- "title:skip"          --> saveToNotion(autoTitle) --> idle
```

**State reset behavior:**
- `/cancel` resets to `defaultSession()` from any state
- Receiving new content while in a non-idle state: text handler auto-resets (line 150-154), photo handler blocks with message (line 177-179), document handler auto-resets (line 203-205)
- After successful save, session resets to `defaultSession()` (line 340)

## Data Flow by Content Type

### Text Message
1. `bot.on('message:text')` at `src/bot.ts:128`
2. Check session state (handle `awaiting_custom_tag` or `awaiting_title` if active)
3. `detectVideoUrl()` checks for video platform URLs
4. If video URL found: `processNewContent(ctx, 'видео', text, '', [], urlNormalize(videoUrl))`
5. If forwarded: extract source string, `processNewContent(ctx, 'пересланное', text, source, [], '')`
6. Otherwise: `processNewContent(ctx, 'текст', text, '', [], '')`

### Photo Message
1. `bot.on('message:photo')` at `src/bot.ts:176`
2. Extract largest photo (`photo[photo.length - 1]`), get `file_id`
3. Extract caption, check for forward origin
4. `processNewContent(ctx, 'фото', caption, source, [largest.file_id], '')`
5. On save: `ctx.api.getFile(fileId)` resolves to Telegram file URL for Notion

### Video URL
1. Detected by `detectVideoUrl()` in `src/utils/text-utils.ts:40`
2. Matches against 8 patterns: YouTube, VK, RuTube, Dzen, OK
3. URL normalized via `urlNormalize()` (strips tracking params, forces HTTPS)
4. Stored as `originalUrl` in session; rendered as bookmark block in Notion

### Forwarded Message
1. Detected via `ctx.message.forward_origin` presence
2. Source extracted from origin type: `channel` (chat title), `user` (first name), or generic
3. Source string stored in session and written to Notion as italic gray paragraph + `Source` property

### Document/Video/Animation/Voice/Audio
1. `bot.on(['message:document', 'message:video', ...])` at `src/bot.ts:200`
2. Auto-resets stale sessions
3. Extracts caption or filename as text
4. Checks for video URL in caption
5. Routes as either `видео` (if URL found) or `пересланное`

## Common Save Path (all content types)

`processNewContent()` at `src/bot.ts:91`:
1. Compute `contentHash(text || originalUrl || imageFileIds.join(','))`
2. `findDuplicate(hash)` queries Notion database for matching `Content Hash` property
3. If duplicate: show duplicate resolution keyboard, pause
4. If unique: populate session, set state to `awaiting_category`, show category keyboard

`saveToNotion()` at `src/bot.ts:307`:
1. For photos: resolve file_ids to Telegram file URLs via `ctx.api.getFile()`
2. Call `createPage()` with all session data
3. Reply with confirmation and Notion page URL
4. Reset session to `defaultSession()`

## External API Integration Points

**Telegram Bot API (via grammY):**
- Long polling (default grammY behavior, no webhook configured)
- `ctx.api.getFile()` - resolve photo file_id to downloadable URL (`src/bot.ts:316`)
- Photo URLs are Telegram-hosted: `https://api.telegram.org/file/bot{token}/{file_path}`
- Bot token: `TELEGRAM_BOT_TOKEN` env var

**Notion API (via @notionhq/client):**
- `notion.databases.query()` - duplicate detection by Content Hash (`src/services/notion.ts:24`)
- `notion.pages.create()` - create page with properties + block children (`src/services/notion.ts:115`)
- `notion.blocks.children.append()` - overflow for >100 blocks (`src/services/notion.ts:123`)
- Auth: `NOTION_TOKEN` env var
- Target: single database identified by `NOTION_DATABASE_ID`

**Notion Database Schema (inferred from property writes in `src/services/notion.ts`):**
| Property | Type | Usage |
|----------|------|-------|
| `Name` | title | Page title |
| `Category` | multi_select | Selected hashtag categories |
| `Content Type` | select | One of: текст, фото, видео, пересланное |
| `Date Added` | date | ISO date string (YYYY-MM-DD) |
| `Source` | rich_text | Forward origin description |
| `Original URL` | url | Video/content URL |
| `Video YaDisk` | url | Yandex Disk URL (property exists but upload not implemented) |
| `Content Hash` | rich_text | SHA-256 hash for deduplication |

## Key Interfaces and Types

**`SessionData`** (`src/bot.ts:9`):
```typescript
interface SessionData {
  state: 'idle' | 'awaiting_category' | 'awaiting_custom_tag' | 'awaiting_title'
  contentType: ContentType
  text: string
  source: string
  imageFileIds: string[]
  originalUrl: string
  selectedCategories: string[]
  hash: string
}
```

**`ContentType`** (`src/services/notion.ts:8`):
```typescript
type ContentType = 'текст' | 'фото' | 'видео' | 'пересланное'
```

**`PageData`** (`src/services/notion.ts:10`):
```typescript
interface PageData {
  title: string
  categories: string[]
  contentType: ContentType
  source?: string
  text?: string
  imageUrls?: string[]
  originalUrl?: string
  videoYaDiskUrl?: string
  contentHash?: string
}
```

**`MyContext`** (`src/bot.ts:43`):
```typescript
type MyContext = Context & { session: SessionData }
```

## Error Handling

**Strategy:** Try-catch at two levels with console logging and user-facing error messages.

**Patterns:**
- Global bot error handler: `bot.catch()` at `src/bot.ts:48` - catches unhandled errors from any handler
- Logging middleware wraps `next()` in try-catch (`src/bot.ts:59`) - logs stack traces, prevents crashes
- `saveToNotion()` has its own try-catch (`src/bot.ts:335`) - reports save failures to user with error message
- Config validation: `required()` in `src/config.ts:8` throws on missing env vars at startup

**No retry logic exists anywhere.** A failed Notion API call simply reports the error to the user.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` with tagged prefixes: `[IN]`, `[OK]`, `[ERR]`, `[TEXT]`, `[DOC]`, `[SAVE]`, `[WARN]`, `[FALLBACK]`

**Validation:** Minimal. Owner check via middleware. No input sanitization beyond tag `#` stripping. Notion enforces its own limits (100 blocks per create, 2000 char rich_text).

**Authentication:** Single-user bot. Owner identified by hardcoded `OWNER_CHAT_ID = 81006248` in `src/config.ts:24`. All non-owner chats are rejected at middleware level.

**Deduplication:** Content hash (SHA-256 of normalized text/URL/file_ids) stored as Notion property, queried before each save.

---

*Architecture analysis: 2026-03-28*
