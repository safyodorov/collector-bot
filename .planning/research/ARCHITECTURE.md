# Architecture Patterns

**Domain:** Telegram bot storage migration (Notion API -> Yandex.Disk WebDAV)
**Researched:** 2026-03-28

## Recommended Architecture

Replace `src/services/notion.ts` with three focused modules. Do not create a generic `StorageService` interface -- there will never be a third backend, and premature abstraction adds indirection without value. Keep the same function signatures (`findDuplicate`, `saveEntry`) so `bot.ts` changes are minimal.

```
bot.ts (orchestrator)
  |
  |-- saveEntry(ctx, title)
  |     |
  |     |-- markdown.ts: buildMarkdown(PageData) -> string
  |     |-- webdav.ts:   putFile(path, content) -> void
  |     |                getFile(path) -> Buffer | null
  |     |                exists(path) -> boolean
  |     |                ensureDir(path) -> void
  |     |-- storage.ts:  saveEntry(data: PageData) -> { path: string }
  |     |                findDuplicate(hash: string) -> DupInfo | null
  |     |                (uses webdav.ts + markdown.ts internally)
  |     |
  |     |-- Photo pipeline (inside storage.ts):
  |           Telegram file_id
  |             -> ctx.api.getFile(file_id)
  |             -> fetch(telegram_file_url) -> Buffer
  |             -> webdav.putFile("vault/attachments/{hash}.jpg", buffer)
  |             -> returns local path "attachments/{hash}.jpg"
  |
  |-- text-utils.ts: sanitizeFilename() added here
  |-- content-hash.ts: unchanged
  |-- config.ts: WEBDAV_URL, WEBDAV_TOKEN replace NOTION_*
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `src/services/webdav.ts` | Low-level WebDAV HTTP operations (PUT, GET, MKCOL, PROPFIND, DELETE). Auth headers. Retry logic. | Yandex.Disk WebDAV endpoint only |
| `src/services/markdown.ts` | Generate Obsidian-compatible markdown with YAML frontmatter from PageData. Pure function, no I/O. | Nothing (pure) |
| `src/services/storage.ts` | High-level operations: save a note (photos + markdown + index), find duplicates, hashtag-to-folder mapping. Orchestrates webdav.ts + markdown.ts. | webdav.ts, markdown.ts |
| `src/bot.ts` | Telegram handling, session state machine. Calls storage.ts. | storage.ts, config.ts |
| `src/utils/text-utils.ts` | Pure text utilities. Add `sanitizeFilename()`. | Nothing (pure) |

## Module Design Detail

### webdav.ts -- Low-Level WebDAV Client

Use native `fetch()` (Node 22 has it built-in). No npm dependency needed. WebDAV is just HTTP with custom methods.

**Confidence:** HIGH -- verified that `fetch` supports custom HTTP methods (PUT, MKCOL, PROPFIND) natively in Node 22. Yandex.Disk WebDAV endpoint confirmed at `https://webdav.yandex.ru`.

```typescript
// src/services/webdav.ts

const WEBDAV_BASE = 'https://webdav.yandex.ru'

interface WebDAVConfig {
  token: string       // OAuth token from YANDEX_DISK_TOKEN
  vaultPath: string   // e.g. "/Obsidian/CollectorVault"
}

// Core operations:
export async function putFile(path: string, content: Buffer | string, contentType?: string): Promise<void>
export async function getFile(path: string): Promise<Buffer | null>  // null = 404
export async function exists(path: string): Promise<boolean>         // HEAD or PROPFIND Depth:0
export async function ensureDir(path: string): Promise<void>         // recursive MKCOL
export async function deleteFile(path: string): Promise<void>
```

**Auth header:** `Authorization: OAuth ${YANDEX_DISK_TOKEN}` -- Yandex.Disk WebDAV supports OAuth tokens directly.

**exists() implementation:** Use a lightweight `PROPFIND` with `Depth: 0` on the target path. Response 207 = exists, 404 = does not exist. Alternatively, `HEAD` request -- but PROPFIND is more standard for WebDAV.

**ensureDir() implementation:** Yandex.Disk returns `409 Conflict` if parent directory is missing. So `ensureDir("/a/b/c/")` must create each level sequentially: `/a/`, then `/a/b/`, then `/a/b/c/`. Check existence before MKCOL to avoid errors on already-existing dirs (MKCOL on existing dir returns an error, not idempotent). Cache created dirs in a `Set<string>` for the process lifetime.

**PROPFIND for directory listing:**
```typescript
// Minimal PROPFIND body to check existence
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
  </D:prop>
</D:propfind>`

// Headers: Depth: 0 for single resource, Depth: 1 for directory contents
```

**Response parsing:** PROPFIND returns XML `207 Multi-Status`. For `exists()` checks, we only need the HTTP status code (207 vs 404), no XML parsing needed. For directory listings (if ever needed for index recovery), use a lightweight regex or `DOMParser` -- avoid adding an XML parsing dependency for a handful of calls.

### markdown.ts -- Obsidian Markdown Generator

Pure function. No I/O, no dependencies beyond Node built-ins.

```typescript
// src/services/markdown.ts

export function buildMarkdown(data: PageData, attachmentPaths: string[]): string
```

**Output format:**
```markdown
---
title: "Шарлотка с яблоками"
categories:
  - выпечка
  - десерты
content_type: фото
date_added: 2026-03-28
source: "Канал рецептов"
original_url: ""
content_hash: "a1b2c3d4..."
---

Рецепт шарлотки: 4 яблока, 3 яйца, стакан сахара...

![[attachments/a1b2c3d4.jpg]]
```

**Design decisions:**
- YAML frontmatter uses arrays for categories (Obsidian Dataview compatible)
- Image embeds use Obsidian wikilink syntax `![[path]]` not standard markdown `![](path)`
- `content_hash` in frontmatter enables future index rebuilds from files alone
- Empty fields omitted from frontmatter to keep notes clean
- Body text before attachments (natural reading order)
- Video URLs rendered as plain links, not bookmarks (no Notion equivalent in markdown)
- Source line rendered as italic: `*Источник: Канал рецептов*`

### storage.ts -- High-Level Storage Operations

Orchestrates webdav.ts and markdown.ts. This is the module `bot.ts` calls directly.

```typescript
// src/services/storage.ts

export interface DupInfo {
  path: string
  title: string
  date: string
}

export interface SaveResult {
  path: string       // vault-relative path to the saved .md file
}

// Main API (mirrors current notion.ts signatures):
export async function findDuplicate(hash: string): Promise<DupInfo | null>
export async function saveEntry(data: PageData, photoBuffers: Map<string, Buffer>): Promise<SaveResult>
```

**Hashtag-to-folder mapping:**
```typescript
const FOLDER_MAP: Record<string, string> = {
  // Recipes
  'завтраки': 'Рецепты', 'супы': 'Рецепты', 'выпечка': 'Рецепты',
  'мясо': 'Рецепты', 'салаты': 'Рецепты', 'десерты': 'Рецепты',
  'напитки': 'Рецепты', 'соусы': 'Рецепты', 'заготовки': 'Рецепты',
  'рецепт': 'Рецепты', 'еда': 'Рецепты', 'готовка': 'Рецепты',
  // Work
  'работа': 'Работа', 'wb': 'Работа', 'wildberries': 'Работа',
  // Ideas
  'идея': 'Идеи', 'проект': 'Идеи',
}
const DEFAULT_FOLDER = 'Разное'

function resolveFolder(categories: string[]): string {
  for (const cat of categories) {
    if (FOLDER_MAP[cat]) return FOLDER_MAP[cat]
  }
  return DEFAULT_FOLDER
}
```

**Filename convention:** `YYYY-MM-DD_Sanitized-Title.md`

Example: `2026-03-28_Шарлотка-с-яблоками.md`

The `sanitizeFilename()` function (in text-utils.ts):
- Strip characters: `/ \ : * ? " < > |`
- Replace whitespace sequences with `-`
- Truncate to 180 chars (leave room for date prefix + extension)
- Handle edge cases: empty -> "Без-названия", dots-only -> cleaned

## Photo Pipeline: Telegram file_id to WebDAV

This is the critical architecture change. Current code passes Telegram URLs (which expire in ~1 hour) to Notion, which fetches them. WebDAV requires us to download the bytes ourselves and PUT them.

### Pipeline Steps

```
1. bot.ts: ctx.api.getFile(file_id) -> { file_path }
2. bot.ts: fetch("https://api.telegram.org/file/bot${TOKEN}/${file_path}") -> Response
3. bot.ts: response.arrayBuffer() -> Buffer
4. bot.ts: pass Buffer to storage.saveEntry() in photoBuffers map
5. storage.ts: compute filename as {content_hash}.jpg (or first 12 chars of hash)
6. storage.ts: webdav.ensureDir("vault/attachments/")
7. storage.ts: webdav.putFile("vault/attachments/{hash}.jpg", buffer, "image/jpeg")
8. storage.ts: collect attachment path "attachments/{hash}.jpg"
9. storage.ts: pass attachment paths to markdown.buildMarkdown()
10. markdown.ts: renders as ![[attachments/{hash}.jpg]]
```

### Why Download in bot.ts, Not storage.ts

The `ctx.api.getFile()` call requires the grammY context. Storage should not depend on Telegram API. So bot.ts downloads the photo bytes and passes raw Buffers to storage. This keeps storage.ts focused on WebDAV + markdown.

### Photo Naming

Use first 12 characters of the content hash: `a1b2c3d4e5f6.jpg`. This is:
- Deterministic (same photo = same filename = natural deduplication)
- Short enough for readability
- Collision-resistant (12 hex chars = 48 bits = 281 trillion combinations)

If the note has multiple photos, each gets its own hash-based filename. The content hash for deduplication is computed from all file_ids joined, but each photo's individual hash determines its attachment filename.

### Photo Format

Telegram returns JPEG for photos (the `photo` array). Use `.jpg` extension. For documents that happen to be images, check the MIME type from `file.mime_type` and use appropriate extension.

## Deduplication Approach

### Current: Notion Database Query
`findDuplicate(hash)` queries Notion database with `Content Hash` property filter. Server-side indexed query, fast.

### New: Index File on WebDAV

Maintain `_collector_index.json` at vault root. Structure:

```json
{
  "version": 1,
  "entries": {
    "a1b2c3d4e5f6...": {
      "path": "Рецепты/2026-03-28_Шарлотка.md",
      "title": "Шарлотка с яблоками",
      "date": "2026-03-28"
    }
  }
}
```

**Operations:**

1. `findDuplicate(hash)`:
   - `webdav.getFile("_collector_index.json")` -> parse JSON
   - Look up hash in `entries` map
   - Return `DupInfo` or null

2. After successful save:
   - Add new entry to the in-memory index
   - `webdav.putFile("_collector_index.json", JSON.stringify(index))` -> overwrite

**Why this approach vs alternatives:**

| Approach | Pros | Cons |
|----------|------|------|
| Index file (chosen) | Fast O(1) lookup, small file, one GET per check | Must keep in sync, corruption risk |
| PROPFIND all files + parse frontmatter | No extra file to maintain | Extremely slow (must download every .md file), O(n) |
| Filename encodes hash | Simple, no index needed | Ugly filenames, hash must be in filename |
| Local SQLite | Fast, rich queries | Not synced to vault, lost on redeploy |

**Index corruption recovery:** If `_collector_index.json` is corrupted or missing, rebuild from vault files by scanning all `.md` files and extracting `content_hash` from YAML frontmatter. This is slow but only needed as emergency recovery. Add a CLI command for this.

**Concurrency:** Single-user bot, no concurrent writes. PUT-after-GET on the index file is safe. No locking needed.

### Alternative: PROPFIND + Filename Convention

A simpler deduplication that avoids the index file entirely:

Use filename format `YYYY-MM-DD_Title__{hash12}.md` where `{hash12}` is first 12 chars of the content hash. Then `findDuplicate(hash)` does:
1. `PROPFIND` with `Depth: 1` on each category folder
2. Check if any filename ends with `__{hash12}.md`

This is simpler but slower (multiple PROPFIND calls across folders). For a vault with <1000 notes, it would work fine. But the index file approach is more robust and faster.

**Recommendation:** Start with the index file. It is the right balance of simplicity and performance.

## Error Handling and Retry Strategy

The current bot has zero retry logic and crashes 12 times in 8 hours. The new storage layer must be more resilient.

### Retry Wrapper

```typescript
// src/services/webdav.ts

async function withRetry<T>(
  operation: () => Promise<T>,
  { maxRetries = 3, baseDelay = 1000, label = 'webdav' } = {}
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (err: any) {
      const status = err.status || 0
      const retryable = status === 0 || status === 429 || status === 500 ||
                         status === 502 || status === 503 || status === 504
      if (!retryable || attempt === maxRetries) throw err
      const delay = baseDelay * Math.pow(2, attempt - 1)
      console.log(`[RETRY] ${label} attempt ${attempt}/${maxRetries}, waiting ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}
```

### Error Classes

```typescript
export class WebDAVError extends Error {
  constructor(
    message: string,
    public status: number,
    public method: string,
    public path: string
  ) {
    super(`WebDAV ${method} ${path}: ${status} ${message}`)
  }
}
```

### Specific Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 201 | Created (PUT/MKCOL success) | OK |
| 204 | No Content (PUT overwrite success) | OK |
| 207 | Multi-Status (PROPFIND success) | Parse if needed |
| 404 | Not Found | `exists()` returns false, `getFile()` returns null |
| 405 | Method Not Allowed | MKCOL on existing dir -- ignore in `ensureDir()` |
| 409 | Conflict | Parent dir missing -- `ensureDir()` handles |
| 413 | Payload Too Large | Fatal for photos -- report to user |
| 429 | Rate Limited | Retry with backoff |
| 500-504 | Server Error | Retry with backoff |
| Network Error | Timeout / DNS / Connection refused | Retry with backoff |

### Save Operation Atomicity

The `saveEntry` operation involves multiple WebDAV calls:
1. Upload photos (0-N PUT calls)
2. Upload markdown file (1 PUT call)
3. Update index (1 GET + 1 PUT)

If step 3 fails after step 2 succeeds, the note exists on disk but is not in the index. This means:
- The note IS saved and visible in Obsidian (good)
- Deduplication won't detect it on next attempt (minor -- worst case is a duplicate note)
- Next successful save will write the index normally

This is acceptable for a single-user bot. No transaction mechanism needed.

If step 2 fails after step 1 succeeds, orphan photos exist in `attachments/`. This is harmless -- they take minimal space and can be cleaned up later.

## Vault Directory Structure

```
/Obsidian/CollectorVault/          (WEBDAV_VAULT_PATH)
  _collector_index.json            (dedup index, hidden from Obsidian by _ prefix)
  Рецепты/
    2026-03-28_Шарлотка.md
    2026-03-27_Борщ-классический.md
  Работа/
    2026-03-28_Отчёт-WB.md
  Идеи/
    2026-03-28_Ландшафтный-проект.md
  Разное/
    2026-03-28_Заметка.md
  attachments/
    a1b2c3d4e5f6.jpg
    b2c3d4e5f6a7.jpg
```

**Folder creation on first use:** `storage.ts` calls `webdav.ensureDir()` for the target folder before each save. The `ensureDir()` function caches created dirs in a `Set<string>` to avoid repeated MKCOL calls.

**Init on startup:** On bot startup, call `ensureDir()` for the vault root and `attachments/` folder. Category folders are created lazily.

## Configuration Changes

```typescript
// src/config.ts additions:
export const WEBDAV_URL = 'https://webdav.yandex.ru'
export const WEBDAV_TOKEN = required('YANDEX_DISK_TOKEN')  // already partially there
export const VAULT_PATH = process.env.VAULT_PATH || '/Obsidian/CollectorVault'

// Removals:
// NOTION_TOKEN -- delete
// NOTION_DATABASE_ID -- delete
```

## Data Flow: Complete Save Path (New)

```
User sends photo with caption in Telegram
  |
  v
bot.ts: message:photo handler
  |-- Extract largest photo file_id
  |-- Extract caption, check forward origin
  |-- processNewContent(ctx, 'фото', caption, source, [file_id], '')
  |     |-- contentHash(caption + file_ids)
  |     |-- storage.findDuplicate(hash)
  |     |     |-- webdav.getFile("_collector_index.json")
  |     |     |-- parse JSON, lookup hash
  |     |     |-- return DupInfo | null
  |     |-- if dup: show duplicate keyboard
  |     |-- if new: session.state = 'awaiting_category'
  |
  ... user selects categories, confirms title ...
  |
  v
bot.ts: saveEntry(ctx, title)
  |
  |-- Download photo bytes:
  |     for each file_id in session.imageFileIds:
  |       file = await ctx.api.getFile(file_id)
  |       response = await fetch(telegram_url)
  |       buffer = Buffer.from(await response.arrayBuffer())
  |       photoBuffers.set(individualHash, buffer)
  |
  |-- storage.saveEntry(pageData, photoBuffers)
  |     |
  |     |-- Resolve folder: resolveFolder(categories) -> "Рецепты"
  |     |-- Build filename: "2026-03-28_Шарлотка.md"
  |     |-- Upload photos:
  |     |     webdav.ensureDir("vault/attachments/")
  |     |     for each (hash, buffer) in photoBuffers:
  |     |       webdav.putFile("vault/attachments/{hash}.jpg", buffer, "image/jpeg")
  |     |     collect paths: ["attachments/{hash}.jpg"]
  |     |
  |     |-- Generate markdown:
  |     |     markdown.buildMarkdown(pageData, attachmentPaths) -> string
  |     |
  |     |-- Upload note:
  |     |     webdav.ensureDir("vault/Рецепты/")
  |     |     webdav.putFile("vault/Рецепты/2026-03-28_Шарлотка.md", mdString)
  |     |
  |     |-- Update index:
  |     |     index = webdav.getFile("vault/_collector_index.json") -> parse
  |     |     index.entries[hash] = { path, title, date }
  |     |     webdav.putFile("vault/_collector_index.json", JSON.stringify(index))
  |     |
  |     |-- return { path: "Рецепты/2026-03-28_Шарлотка.md" }
  |
  |-- Reply: "Saved: Шарлотка #выпечка -> Рецепты/"
  |-- Reset session
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Generic StorageService Interface
**What:** Creating `interface StorageService { save(); find(); }` with `NotionStorage` and `WebDAVStorage` implementations.
**Why bad:** YAGNI. There will never be a third backend. The interface adds a layer of indirection that makes debugging harder. The Notion code will be deleted entirely, not kept as a fallback.
**Instead:** Replace notion.ts directly. Keep the same exported function names. Test the new implementation, delete the old one.

### Anti-Pattern 2: XML Parsing Library for PROPFIND
**What:** Adding an XML parsing dependency (fast-xml-parser, etc.) to parse PROPFIND responses.
**Why bad:** The bot only needs existence checks (HTTP status) and the index file (JSON). Full PROPFIND XML parsing is only needed for directory listing, which the index file approach avoids.
**Instead:** For `exists()`, check HTTP status code only. If directory listing is ever needed (index recovery), use simple regex on the XML response to extract `<D:href>` values.

### Anti-Pattern 3: Downloading Photos in storage.ts
**What:** Passing Telegram file_ids to storage.ts and letting it call the Telegram API.
**Why bad:** Couples storage layer to Telegram. Makes storage.ts untestable without Telegram mocks.
**Instead:** bot.ts downloads photo bytes, passes raw Buffers to storage.ts. Storage only knows about WebDAV.

### Anti-Pattern 4: Hash in Filename for Deduplication
**What:** Encoding content hash in note filename for PROPFIND-based dedup.
**Why bad:** Ugly filenames visible in Obsidian. PROPFIND across multiple folders is slow. Forces filename format constraints.
**Instead:** Use the index file. Keep filenames human-readable.

## Scalability Considerations

| Concern | At 100 notes | At 1K notes | At 10K notes |
|---------|-------------|-------------|--------------|
| Index file size | ~5 KB | ~50 KB | ~500 KB |
| Index GET/PUT time | Instant | <100ms | ~500ms (acceptable) |
| PROPFIND alternative | Fast | Slow | Impractical |
| Attachment storage | ~50 MB | ~500 MB | ~5 GB (Yandex free = 5 GB) |
| Obsidian sync time | Instant | Seconds | Minutes (Remotely Save concern) |

At 10K notes, the index file approach still works. The attachment storage might hit Yandex.Disk free tier limits. If that happens, consider compressing photos before upload (sharp library, available on the VPS).

## Sources

- [Yandex.Disk WebDAV API](https://yandex.com/dev/disk/webdav/) -- Official documentation, HIGH confidence
- [PROPFIND Reference](https://yandex.com/dev/disk/doc/dg/reference/propfind-docpage/) -- Yandex-specific PROPFIND docs
- [MKCOL Reference](https://yandex.com/dev/disk/doc/dg/reference/mkcol.html) -- Directory creation, 409 on missing parent confirmed
- [RFC 4918](http://www.webdav.org/specs/rfc4918.html) -- WebDAV protocol specification
- [webdav npm package](https://www.npmjs.com/package/webdav) -- Reference only, not using (native fetch preferred per project constraint)

---

*Architecture research: 2026-03-28*
