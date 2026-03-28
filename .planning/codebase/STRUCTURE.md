# Codebase Structure

**Analysis Date:** 2026-03-28

## Directory Layout

```
collector-bot/
├── src/                    # TypeScript source code
│   ├── index.ts            # Entry point - starts bot, signal handlers
│   ├── bot.ts              # Core bot logic - handlers, state machine, middleware
│   ├── config.ts           # Environment config loading and validation
│   ├── services/
│   │   └── notion.ts       # Notion API client - page creation, duplicate check
│   ├── keyboards/
│   │   └── hashtags.ts     # Inline keyboard builders (category, title, duplicate)
│   └── utils/
│       ├── text-utils.ts   # Text splitting, auto-title, video URL detection
│       └── content-hash.ts # SHA-256 hashing, URL normalization
├── dist/                   # Compiled JS output (generated)
├── scripts/                # Utility scripts (not part of core bot)
├── .env                    # Environment variables (not committed)
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── ecosystem.config.cjs    # PM2 process manager config
```

## Directory Purposes

**`src/`:**
- Purpose: All application source code
- Contains: TypeScript files organized by concern
- Key files: `bot.ts` (80% of logic), `config.ts`, `index.ts`

**`src/services/`:**
- Purpose: External API integrations
- Contains: Notion client and operations
- Key files: `notion.ts`

**`src/keyboards/`:**
- Purpose: Telegram UI components (inline keyboards)
- Contains: Keyboard builder functions
- Key files: `hashtags.ts`

**`src/utils/`:**
- Purpose: Pure utility functions with no side effects
- Contains: Text processing, hashing
- Key files: `text-utils.ts`, `content-hash.ts`

**`dist/`:**
- Purpose: Compiled JavaScript output
- Generated: Yes (by `tsc`)
- Committed: Check .gitignore, but typically not committed

**`scripts/`:**
- Purpose: Auxiliary scripts outside the main bot process
- Generated: No
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/index.ts`: Process entry point, starts bot polling
- `src/bot.ts`: Bot instance creation and all handler registration

**Configuration:**
- `src/config.ts`: All env var loading and typed exports
- `.env`: Runtime secrets (TELEGRAM_BOT_TOKEN, NOTION_TOKEN, NOTION_DATABASE_ID)
- `tsconfig.json`: TypeScript compiler settings
- `ecosystem.config.cjs`: PM2 deployment config
- `package.json`: Dependencies, scripts (`build`, `start`, `dev`)

**Core Logic:**
- `src/bot.ts`: Message handlers, state machine, callback handlers, save orchestration
- `src/services/notion.ts`: All Notion read/write operations

**UI:**
- `src/keyboards/hashtags.ts`: All three keyboard types

**Utilities:**
- `src/utils/text-utils.ts`: Text chunking, title generation, video URL detection
- `src/utils/content-hash.ts`: Content hashing, URL cleanup

## Naming Conventions

**Files:**
- kebab-case: `text-utils.ts`, `content-hash.ts`
- Singular nouns for services: `notion.ts`, `hashtags.ts`

**Directories:**
- Plural nouns: `services/`, `keyboards/`, `utils/`

**Exports:**
- Named exports only (no default exports anywhere)
- Functions: camelCase (`createPage`, `buildCategoryKeyboard`, `contentHash`)
- Types/Interfaces: PascalCase (`SessionData`, `PageData`, `ContentType`, `MyContext`)

## Where to Add New Code

**New content type handler:**
- Add handler in `src/bot.ts` using `bot.on('message:...')`
- Add content type to `ContentType` union in `src/services/notion.ts`
- Call `processNewContent()` with appropriate parameters

**New external service integration:**
- Create `src/services/{service-name}.ts`
- Export typed functions, import config from `src/config.ts`
- Add required env vars to `src/config.ts`

**New keyboard layout:**
- Add builder function in `src/keyboards/hashtags.ts` (or create new file in `src/keyboards/`)
- Return `InlineKeyboard` instance
- Handle callbacks in `bot.on('callback_query:data')` in `src/bot.ts`

**New utility function:**
- Pure text/data processing: `src/utils/text-utils.ts` or new file in `src/utils/`
- Keep functions pure (no side effects, no imports from services)

**New config variable:**
- Add to `src/config.ts` using `required()` for mandatory or `process.env.X || default` for optional
- Add to `.env`

## Special Directories

**`dist/`:**
- Purpose: TypeScript compilation output
- Generated: Yes, via `npm run build` / `tsc`
- Committed: Likely no

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes, via `npm install`
- Committed: No

---

*Structure analysis: 2026-03-28*
