# Codebase Concerns

**Analysis Date:** 2026-03-28

## Tech Debt

### Deep Notion API Coupling

- Issue: The entire storage layer is hardcoded to Notion API with no abstraction or interface layer. Notion-specific constructs (BlockObjectRequest, database queries, page creation with Notion property schemas) are used directly in `src/services/notion.ts` and called directly from `src/bot.ts`.
- Files: `src/services/notion.ts`, `src/bot.ts` (lines 4, 307-338)
- Impact: Migrating to WebDAV/Obsidian requires rewriting `notion.ts` entirely and updating all call sites in `bot.ts`. There is no storage interface to swap implementations.
- Fix approach: Create a `StorageService` interface with `findDuplicate(hash)` and `savePage(data)` methods. Implement `NotionStorage` and `ObsidianWebDAVStorage` behind it. Update `bot.ts` to use the interface. This allows gradual migration and fallback.

### No Storage Abstraction Layer

- Issue: `bot.ts` directly imports `createPage` and `findDuplicate` from `src/services/notion.ts` and passes Notion-shaped data (property names like 'Content Hash', 'Category', block types like 'paragraph', 'image', 'bookmark'). The `PageData` interface in `src/services/notion.ts` is Notion-oriented but could serve as a migration bridge.
- Files: `src/services/notion.ts` (lines 8-20, 42-130), `src/bot.ts` (line 4, lines 307-338)
- Impact: The `PageData` interface is actually fairly clean and mostly storage-agnostic (title, categories, contentType, text, imageUrls, etc.). The Notion-specific logic is contained in `createPage()`. Migration can preserve `PageData` as the contract.
- Fix approach: Keep `PageData` as the shared interface. Replace `createPage` and `findDuplicate` implementations with WebDAV equivalents. The `bot.ts` call sites at lines 322-331 and 95 need minimal changes if the function signatures stay the same.

### Hardcoded Notion UI Text

- Issue: User-facing messages reference Notion explicitly.
- Files: `src/bot.ts` (line 79: "я сохраню это в Notion"), function name `saveToNotion` (line 307)
- Impact: Cosmetic but confusing after migration. Users see "Notion" references when data goes to Obsidian.
- Fix approach: Change string literals and rename function to `saveEntry` or `saveContent`.

## Stability: 12 Restarts in 8 Hours

### No Crash Recovery or Retry Logic

- Issue: The bot has no retry mechanism for any external API call. Notion API failures, Telegram API failures, and network timeouts all result in immediate error propagation. The only error handling is a try/catch in `saveToNotion` (line 312) that reports the error to the user but does not retry.
- Files: `src/bot.ts` (lines 312-338), `src/services/notion.ts` (all API calls), `src/index.ts` (no uncaught exception handler)
- Impact: Transient Notion API errors (rate limits, 502s, timeouts) cause user-visible failures. If grammy's polling encounters repeated errors, PM2 restarts the process. 12 restarts in 8 hours suggests either Notion API instability or Telegram polling issues.
- Fix approach: Add retry with exponential backoff for storage operations. Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers in `src/index.ts`. Consider adding health logging to track restart causes.

### PM2 Configuration Lacks Restart Limiting

- Issue: `ecosystem.config.cjs` has `autorestart: true` and `max_memory_restart: '256M'` but no `max_restarts`, `min_uptime`, or `restart_delay` settings.
- Files: `ecosystem.config.cjs`
- Impact: Crash loops restart immediately without backoff, potentially hammering APIs. No way to distinguish OOM restarts from crash restarts in logs.
- Fix approach: Add `max_restarts: 15`, `min_uptime: '10s'`, `restart_delay: 3000` to ecosystem config. Add `--log-date-format` for better log forensics.

### Session Loss on Restart

- Issue: grammy sessions use in-memory storage by default. Every PM2 restart wipes all active sessions. If a user is mid-flow (selecting categories, entering title), the session is lost without notification.
- Files: `src/bot.ts` (line 65: `bot.use(session({ initial: defaultSession }))`)
- Impact: With 12 restarts in 8 hours, users likely experience silent session loss regularly. The auto-reset logic at line 150-154 masks this — stale sessions are silently discarded.
- Fix approach: Either accept session loss (sessions are short-lived) and add a user notification on restart, or use grammy's file/database session adapter. For WebDAV migration, sessions should remain in-memory since they're transient.

## Migration-Specific Concerns

### Photo Handling: Telegram URL Expiry vs WebDAV PUT

- Issue: Photos are currently stored as Telegram Bot API URLs (`https://api.telegram.org/file/bot{token}/{file_path}`). These URLs expire after ~1 hour. In `saveToNotion`, the code gets a temporary URL (line 316-319) and passes it to Notion as an external image block. Notion fetches and caches the image at creation time, so expiry doesn't matter.
- Files: `src/bot.ts` (lines 314-319), `src/services/notion.ts` (lines 61-72)
- Impact: WebDAV migration **cannot** use the same approach. Obsidian markdown with external URLs will show broken images after the Telegram URL expires. Photos must be downloaded as binary data, PUT to WebDAV, and referenced as local vault paths in markdown.
- Fix approach: Download photo bytes via `ctx.api.getFile()` + HTTP GET on the file URL. PUT binary to WebDAV at a predictable path (e.g., `attachments/{hash}.jpg`). Reference in markdown as `![[attachments/{hash}.jpg]]`. This is a fundamental architecture change in the photo pipeline.

### Deduplication: Database Query vs File-Based Lookup

- Issue: Current deduplication queries Notion's database API with a filter on the 'Content Hash' rich_text property (lines 23-39 in `src/services/notion.ts`). This is a server-side indexed query.
- Files: `src/services/notion.ts` (lines 23-39), `src/utils/content-hash.ts`
- Impact: Obsidian vault on WebDAV has no query API. Options: (a) download and parse all markdown files to check hashes — extremely slow and scales badly, (b) maintain a local index file (e.g., `_index.json`) on the vault with hash-to-filename mappings, (c) use filename conventions that encode the hash.
- Fix approach: Maintain a `_collector_index.json` file on WebDAV that maps content hashes to file paths. On each save, GET the index, check for duplicates, save the note, then PUT the updated index. Risk: concurrent writes could corrupt the index (unlikely for single-user bot). The `contentHash()` function in `src/utils/content-hash.ts` can be reused as-is.

### Cyrillic Filenames on WebDAV

- Issue: Note titles are in Russian (Cyrillic). The `autoTitle` function in `src/utils/text-utils.ts` generates titles up to 60 characters from message text. Category names are also Cyrillic (`завтраки`, `супы`, etc. in `src/config.ts` line 19).
- Files: `src/utils/text-utils.ts` (lines 22-26), `src/config.ts` (line 19), `src/keyboards/hashtags.ts`
- Impact: Cyrillic filenames in WebDAV paths require proper UTF-8 URL encoding. Yandex.Disk WebDAV generally handles UTF-8 well, but edge cases exist: special characters in titles (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`), very long filenames, and emoji in titles. Obsidian also has filename restrictions.
- Fix approach: Add a `sanitizeFilename(title)` utility that: strips illegal chars (`/\:*?"<>|`), replaces multiple spaces, truncates to 200 chars, and handles edge cases (empty string, dots-only). Apply to all file paths before WebDAV PUT. Keep the original title in the note's YAML frontmatter.

### Markdown Generation: No Template Exists

- Issue: The current code generates Notion blocks (paragraphs, images, bookmarks) in `createPage()`. There is no markdown generation capability anywhere in the codebase.
- Files: `src/services/notion.ts` (lines 43-93)
- Impact: The entire block-building logic in `createPage` must be replaced with Obsidian-compatible markdown generation. This includes: YAML frontmatter for metadata (categories, content type, date, source, hash), body text, image embeds (`![[path]]`), bookmark links, and source attribution.
- Fix approach: Create `src/services/markdown.ts` with a `buildMarkdown(data: PageData): string` function that produces Obsidian-flavored markdown with YAML frontmatter. Example output structure:
  ```markdown
  ---
  title: "Note title"
  categories: [завтраки, выпечка]
  content_type: фото
  date_added: 2026-03-28
  source: "Переслано из канала"
  content_hash: abc123...
  ---

  Caption text here

  ![[attachments/abc123.jpg]]
  ```

### WebDAV Client: New Dependency Needed

- Issue: No WebDAV client exists in the project. `package.json` has only three runtime dependencies: `@notionhq/client`, `grammy`, `dotenv`.
- Files: `package.json`
- Impact: Need to add a WebDAV client library or implement raw HTTP PUT/GET/PROPFIND. Yandex.Disk WebDAV endpoint is `https://webdav.yandex.ru`.
- Fix approach: Use `webdav` npm package (mature, well-maintained) or raw `fetch()` with Basic/OAuth auth. The `webdav` package supports all needed operations: PUT (create/update files), GET (read files), MKCOL (create directories), and handles auth.

## Security Considerations

### Bot Token Exposed in Photo URLs

- Risk: Photo URLs constructed at `src/bot.ts` line 318 contain the full bot token: `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`. These URLs are passed to Notion as external images.
- Files: `src/bot.ts` (line 318)
- Impact: Anyone with access to the Notion page can extract the bot token from image URLs. Low risk for private Notion workspace, but a credential leak vector.
- Current mitigation: Notion workspace is presumably private.
- Recommendations: For WebDAV migration, this issue disappears naturally since photos will be downloaded and re-uploaded as binary. No token in stored URLs.

### YANDEX_DISK_TOKEN Already in Config

- Issue: `src/config.ts` line 17 already reads `YANDEX_DISK_TOKEN` from env but it's unused in the codebase. This was likely added in preparation for migration.
- Files: `src/config.ts` (line 17)
- Impact: None currently. The token exists in `.env` but no code uses it.
- Recommendations: Use this for WebDAV authentication. Yandex.Disk WebDAV accepts OAuth tokens as Bearer auth.

## Fragile Areas

### Session State Machine

- Files: `src/bot.ts` (lines 9-18, 90-173, 228-299)
- Why fragile: The session state machine (`idle` → `awaiting_category` → `awaiting_custom_tag` → `awaiting_title` → save → `idle`) has implicit transitions. State is checked in multiple handlers (`message:text`, `callback_query:data`) with no centralized state management. The auto-reset at line 150-154 is a band-aid for stuck sessions.
- Safe modification: During migration, the session state machine does not need to change. Only the `saveToNotion` function (line 307) needs replacement. Keep the state machine intact.
- Test coverage: No tests exist.

### Photo Handler Blocks on Active Session

- Files: `src/bot.ts` (lines 176-197)
- Why fragile: The photo handler (line 177-179) rejects photos if `state !== 'idle'`, unlike the text handler which auto-resets. This means if a user sends a photo during category selection, it's silently rejected with a message. Inconsistent with text handler behavior.
- Safe modification: Align behavior — either auto-reset (like text handler) or reject (like photo handler) consistently.
- Test coverage: No tests exist.

## Missing Critical Features

### No Logging to File

- Problem: All logging goes to stdout via `console.log`/`console.error`. PM2 captures this, but there's no structured logging, no log levels, no correlation IDs.
- Blocks: Diagnosing the 12-restart problem. Without structured logs, it's hard to distinguish OOM from crash from API failure.
- Fix approach: At minimum, add timestamps and error categorization. For WebDAV migration, log all WebDAV request/response status codes to diagnose connectivity issues.

### No Health Check Endpoint

- Problem: No HTTP endpoint for monitoring. PM2 can only check if the process is alive, not if the bot is actually processing messages.
- Blocks: Automated monitoring, distinguishing "running but stuck" from "running and healthy".

### No Graceful Degradation

- Problem: If the storage backend (Notion or future WebDAV) is down, every save attempt fails with an error message. There's no queue or retry mechanism.
- Blocks: Reliability during WebDAV migration. Network issues to Yandex.Disk will cause immediate failures.
- Fix approach: Add a simple file-based queue. On save failure, write the `PageData` to a local JSON file. On next successful save, drain the queue. This prevents data loss during transient outages.

## Test Coverage Gaps

### No Tests At All

- What's not tested: The entire codebase has zero test files. No unit tests, no integration tests, no mocking.
- Files: No `*.test.ts`, `*.spec.ts`, or `__tests__/` directory exists anywhere.
- Risk: Any migration change could break existing functionality with no safety net. The session state machine, content hashing, text splitting, URL normalization — all untested.
- Priority: **High** — before migration, add at minimum:
  1. Unit tests for `src/utils/content-hash.ts` (pure functions, easy to test)
  2. Unit tests for `src/utils/text-utils.ts` (pure functions)
  3. Integration test for the new WebDAV storage service with a mock server

## Dependencies at Risk

### @notionhq/client Removal

- Risk: After migration, `@notionhq/client` becomes dead code but may remain in `package.json`.
- Impact: Unnecessary dependency, potential confusion.
- Migration plan: Remove after confirming WebDAV storage works. Also remove `NOTION_TOKEN` and `NOTION_DATABASE_ID` from config.

## Migration Checklist Summary

The following files need changes for Notion → Obsidian/WebDAV migration:

| File | Change Required |
|------|----------------|
| `src/services/notion.ts` | Replace entirely with `src/services/obsidian-webdav.ts` |
| `src/bot.ts` | Update imports (line 4), rename `saveToNotion` → `saveEntry`, update photo handling (lines 314-319), change UI text (line 79) |
| `src/config.ts` | Remove `NOTION_TOKEN`, `NOTION_DATABASE_ID`. Add `WEBDAV_URL`, `WEBDAV_VAULT_PATH`. `YANDEX_DISK_TOKEN` already exists. |
| `package.json` | Remove `@notionhq/client`, add `webdav` |
| `src/utils/content-hash.ts` | No changes needed — reuse as-is |
| `src/utils/text-utils.ts` | Add `sanitizeFilename()` function |
| `src/keyboards/hashtags.ts` | No changes needed |
| `ecosystem.config.cjs` | Add restart limits |
| NEW: `src/services/markdown.ts` | Obsidian markdown + YAML frontmatter generator |

---

*Concerns audit: 2026-03-28*
