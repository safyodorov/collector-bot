<!-- GSD:project-start source:PROJECT.md -->
## Project

**Collector Bot: Notion → Obsidian Migration**

Telegram-бот для сбора контента (текст, фото, видео-ссылки, пересланные сообщения) с категоризацией через inline-кнопки. Сейчас сохраняет в Notion, мигрирует на Obsidian vault на Яндекс.Диске через WebDAV. Единственный пользователь — владелец бота (Сергей Фёдоров).

**Core Value:** Контент из Telegram попадает в Obsidian vault быстро, с категориями, и доступен на всех устройствах через Яндекс.Диск.

### Constraints

- **Tech stack**: TypeScript, grammy, Node.js 22 — не меняется
- **Storage**: WebDAV Яндекс.Диска — единственный вариант хранилища
- **Format**: Obsidian-совместимый Markdown с YAML frontmatter
- **Compatibility**: Существующий UX бота не должен измениться для пользователя
- **Single user**: Бот для одного пользователя, конкурентность не проблема
- **No new deps**: WebDAV через нативный fetch, без дополнительных npm-пакетов
- **Cyrillic**: Имена файлов и папок на русском, нужна санитизация
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.7+ - All source code in `src/`
- JavaScript (CommonJS) - PM2 config only (`ecosystem.config.cjs`)
## Runtime
- Node.js (no `.nvmrc` present; production VPS runs Node.js v22)
- ES Modules (`"type": "module"` in `package.json`)
- npm
- Lockfile: `package-lock.json` (assumed standard)
## Frameworks
- grammY ^1.30.0 - Telegram Bot framework (long polling mode)
- TypeScript ^5.7.0 - Compilation via `tsc`
- tsx ^4.19.0 - Dev-time execution (`npm run dev`)
## Key Dependencies
- `grammy` ^1.30.0 - Telegram Bot API client. Used in `src/bot.ts`, `src/keyboards/hashtags.ts`
- `@notionhq/client` ^2.2.15 - Notion API SDK. Used in `src/services/notion.ts`
- `dotenv` ^16.4.7 - Environment variable loading. Used in `src/config.ts`
- `@types/node` ^22.0.0 - Node.js type definitions
- `tsx` ^4.19.0 - TypeScript execution for development
- `typescript` ^5.7.0 - Compiler
- `node:crypto` - SHA-256 content hashing (`src/utils/content-hash.ts`)
- `node:path` / `node:url` - Path resolution for .env loading (`src/config.ts`)
## Configuration
- Target: ES2022
- Module system: NodeNext (ESM with `.js` extensions in imports)
- Strict mode: enabled
- Source maps: enabled
- Declarations: enabled
- Output: `dist/`
- Root: `src/`
| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API authentication |
| `NOTION_TOKEN` | Yes | Notion API integration token |
| `NOTION_DATABASE_ID` | Yes | Target Notion database for content storage |
| `YANDEX_DISK_TOKEN` | No | Yandex.Disk API for video storage (optional, default empty) |
| `DEFAULT_HASHTAGS` | No | Comma-separated category list (default: завтраки,супы,выпечка,...) |
| `MAX_VIDEO_SIZE_MB` | No | Video size limit (default: 500) |
| `VIDEO_QUALITY` | No | Video quality setting (default: 1080) |
## External APIs
- Client: grammY `Bot` class
- Auth: `TELEGRAM_BOT_TOKEN` env var
- Mode: Long polling (`bot.start()`)
- Used for: Receiving messages, sending replies, inline keyboards, file downloads
- File download URL pattern: `https://api.telegram.org/file/bot{token}/{file_path}`
- Client: `@notionhq/client` `Client` class (`src/services/notion.ts`)
- Auth: `NOTION_TOKEN` env var
- Operations:
- Database properties used: Name, Category (multi_select), Content Type (select), Date Added (date), Source (rich_text), Original URL (url), Video YaDisk (url), Content Hash (rich_text)
- Token loaded in config but no implementation in current source
- Intended for video file storage
## Build & Scripts
## Process Management
- Process name: `collector`
- Script: `dist/index.js`
- Working directory: `/root/collector-bot` (production VPS)
- Memory limit: 256MB (auto-restart on exceed)
- Auto-restart: enabled
- Environment: `NODE_ENV=production`
## Deployment
- Deploy path: `/root/collector-bot/`
- Process manager: PM2
- Deploy flow: `git pull && npm run build && pm2 restart collector`
## Platform Requirements
- Node.js 22+
- npm
- Node.js 22+
- PM2 process manager
- Network access to Telegram API and Notion API
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Stateful conversation flow managed via grammY session middleware (in-memory, per-chat)
- Linear middleware pipeline: logging -> session -> owner guard -> handlers
- All content funnels through a single `processNewContent()` function before entering the state machine
- No database besides Notion; no local persistence of session state (lost on restart)
## Layers
- Purpose: Start the bot, register signal handlers
- Location: `src/index.ts`
- Contains: Bot startup, SIGINT/SIGTERM graceful shutdown
- Depends on: `src/bot.ts`
- Purpose: Load and validate environment variables, export typed constants
- Location: `src/config.ts`
- Contains: `required()` helper, all env var exports, `DEFAULT_HASHTAGS`, `OWNER_CHAT_ID`
- Depends on: `dotenv`, `.env` file
- Used by: Every other module
- Purpose: All Telegram message handling, session state machine, middleware pipeline, orchestration
- Location: `src/bot.ts`
- Contains: Session interface, middleware chain, all message handlers, callback query handlers, `saveToNotion()` orchestrator
- Depends on: `src/config.ts`, `src/services/notion.ts`, `src/keyboards/hashtags.ts`, `src/utils/text-utils.ts`, `src/utils/content-hash.ts`
- Used by: `src/index.ts`
- Purpose: Notion API operations (create pages, find duplicates)
- Location: `src/services/notion.ts`
- Contains: `createPage()`, `findDuplicate()`, `PageData` interface, `ContentType` type
- Depends on: `@notionhq/client`, `src/config.ts`, `src/utils/text-utils.ts`
- Used by: `src/bot.ts`
- Purpose: Build Telegram inline keyboards for user interaction
- Location: `src/keyboards/hashtags.ts`
- Contains: `buildCategoryKeyboard()`, `buildTitleKeyboard()`, `buildDuplicateKeyboard()`
- Depends on: `grammy` (InlineKeyboard), `src/config.ts` (DEFAULT_HASHTAGS)
- Used by: `src/bot.ts`
- Purpose: Pure functions for text processing and content hashing
- Location: `src/utils/text-utils.ts`, `src/utils/content-hash.ts`
- Contains: `splitText()`, `autoTitle()`, `detectVideoUrl()`, `contentHash()`, `urlNormalize()`
- Depends on: `node:crypto` only
- Used by: `src/bot.ts`, `src/services/notion.ts`
## Middleware Pipeline
## Session State Machine
```
```
- `/cancel` resets to `defaultSession()` from any state
- Receiving new content while in a non-idle state: text handler auto-resets (line 150-154), photo handler blocks with message (line 177-179), document handler auto-resets (line 203-205)
- After successful save, session resets to `defaultSession()` (line 340)
## Data Flow by Content Type
### Text Message
### Photo Message
### Video URL
### Forwarded Message
### Document/Video/Animation/Voice/Audio
## Common Save Path (all content types)
## External API Integration Points
- Long polling (default grammY behavior, no webhook configured)
- `ctx.api.getFile()` - resolve photo file_id to downloadable URL (`src/bot.ts:316`)
- Photo URLs are Telegram-hosted: `https://api.telegram.org/file/bot{token}/{file_path}`
- Bot token: `TELEGRAM_BOT_TOKEN` env var
- `notion.databases.query()` - duplicate detection by Content Hash (`src/services/notion.ts:24`)
- `notion.pages.create()` - create page with properties + block children (`src/services/notion.ts:115`)
- `notion.blocks.children.append()` - overflow for >100 blocks (`src/services/notion.ts:123`)
- Auth: `NOTION_TOKEN` env var
- Target: single database identified by `NOTION_DATABASE_ID`
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
```typescript
```
```typescript
```
```typescript
```
```typescript
```
## Error Handling
- Global bot error handler: `bot.catch()` at `src/bot.ts:48` - catches unhandled errors from any handler
- Logging middleware wraps `next()` in try-catch (`src/bot.ts:59`) - logs stack traces, prevents crashes
- `saveToNotion()` has its own try-catch (`src/bot.ts:335`) - reports save failures to user with error message
- Config validation: `required()` in `src/config.ts:8` throws on missing env vars at startup
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
