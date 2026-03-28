# Technology Stack

**Analysis Date:** 2026-03-28

## Languages

**Primary:**
- TypeScript 5.7+ - All source code in `src/`

**Secondary:**
- JavaScript (CommonJS) - PM2 config only (`ecosystem.config.cjs`)

## Runtime

**Environment:**
- Node.js (no `.nvmrc` present; production VPS runs Node.js v22)
- ES Modules (`"type": "module"` in `package.json`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (assumed standard)

## Frameworks

**Core:**
- grammY ^1.30.0 - Telegram Bot framework (long polling mode)
  - Provides `Bot`, `Context`, `session`, `InlineKeyboard`
  - Session middleware for conversational state management
  - Entry: `src/bot.ts`

**Build/Dev:**
- TypeScript ^5.7.0 - Compilation via `tsc`
- tsx ^4.19.0 - Dev-time execution (`npm run dev`)

## Key Dependencies

**Critical (3 production deps):**
- `grammy` ^1.30.0 - Telegram Bot API client. Used in `src/bot.ts`, `src/keyboards/hashtags.ts`
- `@notionhq/client` ^2.2.15 - Notion API SDK. Used in `src/services/notion.ts`
- `dotenv` ^16.4.7 - Environment variable loading. Used in `src/config.ts`

**Dev:**
- `@types/node` ^22.0.0 - Node.js type definitions
- `tsx` ^4.19.0 - TypeScript execution for development
- `typescript` ^5.7.0 - Compiler

**Node.js Built-ins Used:**
- `node:crypto` - SHA-256 content hashing (`src/utils/content-hash.ts`)
- `node:path` / `node:url` - Path resolution for .env loading (`src/config.ts`)

## Configuration

**TypeScript (`tsconfig.json`):**
- Target: ES2022
- Module system: NodeNext (ESM with `.js` extensions in imports)
- Strict mode: enabled
- Source maps: enabled
- Declarations: enabled
- Output: `dist/`
- Root: `src/`

**Environment Variables (`.env`):**

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API authentication |
| `NOTION_TOKEN` | Yes | Notion API integration token |
| `NOTION_DATABASE_ID` | Yes | Target Notion database for content storage |
| `YANDEX_DISK_TOKEN` | No | Yandex.Disk API for video storage (optional, default empty) |
| `DEFAULT_HASHTAGS` | No | Comma-separated category list (default: завтраки,супы,выпечка,...) |
| `MAX_VIDEO_SIZE_MB` | No | Video size limit (default: 500) |
| `VIDEO_QUALITY` | No | Video quality setting (default: 1080) |

Reference: `.env.example` for template, `src/config.ts` for validation logic.

## External APIs

**Telegram Bot API:**
- Client: grammY `Bot` class
- Auth: `TELEGRAM_BOT_TOKEN` env var
- Mode: Long polling (`bot.start()`)
- Used for: Receiving messages, sending replies, inline keyboards, file downloads
- File download URL pattern: `https://api.telegram.org/file/bot{token}/{file_path}`

**Notion API:**
- Client: `@notionhq/client` `Client` class (`src/services/notion.ts`)
- Auth: `NOTION_TOKEN` env var
- Operations:
  - `notion.databases.query()` - Duplicate detection by content hash
  - `notion.pages.create()` - Create new pages with properties and blocks
  - `notion.blocks.children.append()` - Append blocks beyond 100-block limit
- Database properties used: Name, Category (multi_select), Content Type (select), Date Added (date), Source (rich_text), Original URL (url), Video YaDisk (url), Content Hash (rich_text)

**Yandex.Disk API (optional, not yet actively used):**
- Token loaded in config but no implementation in current source
- Intended for video file storage

## Build & Scripts

```bash
npm run build    # tsc - compile TypeScript to dist/
npm run start    # node dist/index.js - run compiled output
npm run dev      # tsx src/index.ts - run in dev mode with tsx
```

## Process Management

**PM2 (`ecosystem.config.cjs`):**
- Process name: `collector`
- Script: `dist/index.js`
- Working directory: `/root/collector-bot` (production VPS)
- Memory limit: 256MB (auto-restart on exceed)
- Auto-restart: enabled
- Environment: `NODE_ENV=production`

## Deployment

**Target:** Production VPS at 212.74.231.132
- Deploy path: `/root/collector-bot/`
- Process manager: PM2
- Deploy flow: `git pull && npm run build && pm2 restart collector`

## Platform Requirements

**Development:**
- Node.js 22+
- npm

**Production:**
- Node.js 22+
- PM2 process manager
- Network access to Telegram API and Notion API

---

*Stack analysis: 2026-03-28*
