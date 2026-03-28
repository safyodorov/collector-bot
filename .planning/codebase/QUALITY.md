# Code Quality Analysis

**Analysis Date:** 2026-03-28

## Code Organization

**Current state: Monolithic `bot.ts`**

All bot logic lives in `src/bot.ts` (343 lines): message handlers, callback query handlers, session management, content processing, and save-to-Notion orchestration are all in one file.

**Separation that exists:**
- `src/config.ts` — environment variables and constants (good, clean)
- `src/services/notion.ts` — Notion API client, `createPage`, `findDuplicate` (good separation)
- `src/utils/text-utils.ts` — `splitText`, `autoTitle`, `detectVideoUrl` (good, pure functions)
- `src/utils/content-hash.ts` — `contentHash`, `urlNormalize` (good, pure functions)
- `src/keyboards/hashtags.ts` — inline keyboard builders (good, UI-only)
- `src/index.ts` — entry point, bot start + graceful shutdown (minimal, correct)

**What belongs in separate files but lives in `bot.ts`:**
- Message handlers (text, photo, document) — lines 128-225
- Callback query handler (category selection, duplicate resolution, title) — lines 228-299
- Session helpers (`hasCategory`, `addCategory`, `removeCategory`) — lines 33-41
- `processNewContent` function — lines 91-125
- `saveToNotion` function — lines 307-341
- `SessionData` interface and `defaultSession` — lines 9-31

**Empty directory:** `src/handlers/` exists but contains no files. It was clearly intended for handler extraction but never used.

## Error Handling

**Global error boundary:**
- `bot.catch()` at line 48 — catches unhandled grammY errors
- Middleware try/catch at lines 53-63 — logs errors per update with stack traces
- Both are good patterns

**Application-level errors:**
- `saveToNotion` has try/catch at line 335, reports error message to user — good
- `findDuplicate` in `src/services/notion.ts` has NO error handling — a Notion API failure during duplicate check will crash the handler and show a raw error via middleware catch
- `processNewContent` calls `findDuplicate` without try/catch — if duplicate check fails, user gets no feedback
- No retry logic for Notion API calls (rate limits, transient failures)

**Config validation:**
- `src/config.ts` uses `required()` helper that throws on missing env vars — clean pattern
- Fails fast at startup, which is correct

## Type Safety

**TypeScript strictness:** `"strict": true` in `tsconfig.json` — good baseline.

**`any` usage (problematic):**
- `src/bot.ts:201` — `const msg = ctx.message as any` in document handler, bypasses type checking for caption/file_name access
- `src/bot.ts:215` — `(origin as any).chat?.title` and `(origin as any).sender_user?.first_name` — grammY types not properly narrowed for forward_origin subtypes
- `src/services/notion.ts:32` — `const page = res.results[0] as any` — Notion API response not typed
- `src/services/notion.ts:95` — `const properties: Record<string, any>` — Notion property builders untyped
- `src/services/notion.ts:125` — `children.slice(100) as any` — cast to bypass type mismatch
- `src/services/notion.ts:129` — `(page as any).url` — Notion page response URL access untyped

**Count:** 6 instances of `any` across 2 files. Most are in Notion API interactions where the SDK types are awkward but could be properly narrowed.

## Test Coverage

**Zero tests.** No test files, no test framework, no test script in `package.json`. The codebase has no automated testing whatsoever.

**Testable units that should have tests:**
- `src/utils/text-utils.ts` — `splitText`, `autoTitle`, `detectVideoUrl` are pure functions, trivially testable
- `src/utils/content-hash.ts` — `contentHash`, `urlNormalize` are pure functions
- `src/keyboards/hashtags.ts` — keyboard builders are pure functions
- `src/services/notion.ts` — `createPage`, `findDuplicate` could be tested with mocked Notion client

## Potential Bugs and Issues

**1. BOT_TOKEN leaked in Telegram file URLs**
- `src/bot.ts:318` — `imageUrls.push(\`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}\`)`
- These URLs are passed to Notion as external image blocks. Telegram file URLs expire after ~1 hour, so images in Notion will break. The BOT_TOKEN is also embedded in the URL stored in Notion.

**2. Session state can get stuck**
- If `processNewContent` throws after setting session state (line 111), the session remains in `awaiting_category` with no way to recover except `/cancel`
- The auto-reset in text handler (line 153) helps but only applies to text messages, not photos (line 177-179 blocks instead of resetting)
- Photo handler at line 177 tells user to `/cancel` instead of auto-resetting like the text and document handlers do. Inconsistent behavior.

**3. Duplicate check has no state transition**
- When a duplicate is found (line 96-108), `ctx.session.state` remains `idle`. If the user sends new content before resolving the duplicate prompt, the state machine gets confused.

**4. `autoTitle` can return empty string**
- `src/utils/text-utils.ts:23` — if `text` is empty string, `text.split('\n')[0]?.trim()` returns `''`, and the fallback `text.trim()` also returns `''`. A Notion page would be created with empty title.

**5. No media group handling**
- Telegram sends multi-photo albums as separate messages. Each photo triggers a separate `processNewContent` call, creating separate Notion pages instead of grouping them.

## Code Duplication

**Forward origin parsing** — repeated 3 times with slight variations:
- `src/bot.ts:162-168` (text handler)
- `src/bot.ts:187-194` (photo handler)
- `src/bot.ts:212-221` (document handler)

Each extracts source string from `forward_origin` differently. The document handler has the most complete version (handles `else` branch). Should be extracted to a shared `parseForwardOrigin(ctx)` function.

**Session field assignment** — `processNewContent` manually copies 6 fields to session (lines 111-118). This pattern is fragile; adding a new field requires remembering to add it here.

**Category display formatting** — `[...s.selectedCategories].map(c => '#' + c).join(' ')` appears at lines 275 and 333. Minor but could be a helper.

## Areas Needing Refactoring for Migration

**Priority 1 — Extract handlers from `bot.ts`:**
- Move message handlers to `src/handlers/messages.ts`
- Move callback query handlers to `src/handlers/callbacks.ts`
- Move `saveToNotion` orchestration to `src/handlers/save.ts` or `src/services/save.ts`
- Move session types and helpers to `src/session.ts`
- `bot.ts` should only wire middleware and register handlers

**Priority 2 — Fix forward origin parsing:**
- Create `src/utils/forward-origin.ts` with a single `parseForwardSource(ctx)` function
- Replace 3 duplicated implementations

**Priority 3 — Add error handling to Notion operations:**
- Wrap `findDuplicate` calls in try/catch in the handler
- Add retry logic for transient Notion API failures
- Consider a `src/services/notion-client.ts` wrapper with built-in retry

**Priority 4 — Fix image URL persistence:**
- Telegram file URLs expire. Images should be downloaded and uploaded to Notion (or another persistent store) rather than referenced by URL.
- This is a data integrity issue, not just code quality.

**Priority 5 — Consistent state management:**
- Photo handler should auto-reset stale sessions like text and document handlers do
- Duplicate detection should set a proper state (`awaiting_duplicate_resolution`)
- Consider a state machine library or at least a clear transition map

**Priority 6 — Add tests:**
- Add vitest or jest
- Start with pure utility functions (zero-mock tests)
- Add integration tests for Notion service with mocked client

---

*Quality analysis: 2026-03-28*
