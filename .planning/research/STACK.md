# Technology Stack

**Project:** Collector Bot (Notion -> Obsidian/WebDAV Migration)
**Researched:** 2026-03-28

## Recommended Stack

### WebDAV Client: Native `fetch` (No Library)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native `fetch` | Node.js 22 built-in | WebDAV operations (PUT, MKCOL, PROPFIND) | Project constraint says "no new deps". The bot needs exactly 3 WebDAV methods — PUT (upload files), MKCOL (create dirs), PROPFIND (check existence). These are plain HTTP requests with custom method strings. A 50-line wrapper beats pulling in `webdav` v5 (ESM-only, 15+ transitive deps, overkill for 3 operations). |

**Why NOT `webdav` npm package:**
- v5 is ESM-only, would force project-wide ESM migration or dynamic imports
- Pulls `@buttercup/fetch` and XML parsing dependencies the bot doesn't need
- The bot does exactly 3 operations — PUT, MKCOL, PROPFIND with Depth:0. A library adds complexity without value.
- PROJECT.md explicitly states "WebDAV через нативный fetch, без дополнительных npm-пакетов"

**Why NOT `ya-disk` / `node-ya-disk`:**
- `yandex-disk` npm: last published 9 years ago, dead
- `ya-disk`: REST API wrapper, not WebDAV
- `node-ya-disk`: Low activity, last meaningful update years ago

### Authentication

| Technology | Purpose | Why |
|------------|---------|-----|
| OAuth token in `Authorization: OAuth <token>` header | Yandex.Disk WebDAV auth | Already have `YANDEX_DISK_TOKEN` in config.ts (line 17). OAuth token is simpler than app passwords (no 2FA prerequisite). Token lasts 12 months. Single header on every request. |

**Why NOT app passwords (Basic auth):**
- Requires 2FA enabled on the Yandex account first
- Two credentials to manage (login + app password) vs one token
- OAuth is the documented primary auth method for Yandex.Disk API

**Auth header format:**
```
Authorization: OAuth y3_Abc123...
```

Note: Yandex OAuth tokens always start with `y` followed by a digit 0-3 and underscore. Token expires in 12 months — add a reminder or handle 401 responses.

### Core Framework (Unchanged)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | existing | Type safety | Already in project |
| grammy | existing | Telegram bot framework | Already in project, not changing |
| Node.js | 22 | Runtime | Already on VPS, has native fetch |
| dotenv | existing | Env management | Already in project |

### New Internal Modules

| Module | Purpose | Notes |
|--------|---------|-------|
| `src/services/webdav.ts` | WebDAV client wrapper (PUT, MKCOL, PROPFIND, GET) | ~80-100 lines. Wraps native fetch with auth headers, error handling, retry logic. |
| `src/services/markdown.ts` | Obsidian markdown + YAML frontmatter generator | Builds .md content from PageData. |
| `src/utils/sanitize.ts` | Filename sanitization for Cyrillic paths | Strips illegal chars, handles encoding. |

## WebDAV Implementation Details

### Endpoint

```
https://webdav.yandex.ru
```

### Operations Needed

#### 1. PUT — Upload File (Markdown or Binary)

```typescript
async function putFile(path: string, content: string | Buffer, contentType: string): Promise<void> {
  const url = `https://webdav.yandex.ru${encodePath(path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `OAuth ${token}`,
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(content).toString(),
    },
    body: content,
  });
  if (res.status !== 201 && res.status !== 204) {
    throw new Error(`PUT ${path} failed: ${res.status} ${res.statusText}`);
  }
}
```

**Response codes:** 201 Created (new file), 204 No Content (overwritten), 507 Insufficient Storage.

#### 2. MKCOL — Create Directory

```typescript
async function mkdir(path: string): Promise<void> {
  const url = `https://webdav.yandex.ru${encodePath(path)}`;
  const res = await fetch(url, {
    method: 'MKCOL',
    headers: { 'Authorization': `OAuth ${token}` },
  });
  // 201 = created, 405 = already exists (OK to ignore)
  if (res.status !== 201 && res.status !== 405) {
    throw new Error(`MKCOL ${path} failed: ${res.status}`);
  }
}
```

**Important:** MKCOL cannot create nested directories in one call. `/vault/Рецепты/` requires `/vault/` to exist first. Create directories recursively.

#### 3. PROPFIND — Check If File/Dir Exists

```typescript
async function exists(path: string): Promise<boolean> {
  const url = `https://webdav.yandex.ru${encodePath(path)}`;
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      'Authorization': `OAuth ${token}`,
      'Depth': '0',
    },
  });
  return res.status === 207; // 207 Multi-Status = exists, 404 = not found
}
```

Use `Depth: 0` to check a single resource (not its children). Avoids unnecessary XML parsing.

#### 4. GET — Read File (for index.json deduplication)

```typescript
async function getFile(path: string): Promise<string | null> {
  const url = `https://webdav.yandex.ru${encodePath(path)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `OAuth ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.text();
}
```

## Cyrillic Path Encoding

**The critical detail:** `fetch()` in Node.js does NOT auto-encode non-ASCII characters in URLs. You must encode Cyrillic path segments manually.

### Encoding Function

```typescript
function encodePath(path: string): string {
  return path
    .split('/')
    .map(segment => segment ? encodeURIComponent(segment) : '')
    .join('/');
}
```

This encodes each path segment independently, preserving `/` separators. Example:

- Input: `/vault/Рецепты/2026-03-28_Шарлотка.md`
- Output: `/vault/%D0%A0%D0%B5%D1%86%D0%B5%D0%BF%D1%82%D1%8B/2026-03-28_%D0%A8%D0%B0%D1%80%D0%BB%D0%BE%D1%82%D0%BA%D0%B0.md`

### Filename Sanitization

Cyrillic filenames are fine on Yandex.Disk. The real issues:

1. **Illegal characters:** Strip `/\:*?"<>|` from filenames (OS + Obsidian restrictions)
2. **Byte length:** Cyrillic chars = 2 bytes in UTF-8. Limit filenames to 120 chars (240 bytes) to stay under EXT4's 255-byte limit with safety margin
3. **Dots and spaces:** Strip leading/trailing dots and spaces (Windows/Obsidian issues)
4. **Empty result:** Fallback to timestamp-based name

```typescript
function sanitizeFilename(title: string): string {
  let name = title
    .replace(/[\/\\:*?"<>|]/g, '')  // illegal chars
    .replace(/\s+/g, ' ')            // collapse spaces
    .replace(/^[\s.]+|[\s.]+$/g, '') // trim dots/spaces
    .slice(0, 120);                   // byte-safe length
  return name || `note_${Date.now()}`;
}
```

## Binary File Uploads (Photos)

### Pipeline

1. Get file path from Telegram: `ctx.api.getFile(fileId)` returns `file_path`
2. Download binary: `fetch(https://api.telegram.org/file/bot${token}/${file_path})`
3. Read as `Buffer`: `Buffer.from(await response.arrayBuffer())`
4. PUT to WebDAV: `putFile('/vault/attachments/abc123.jpg', buffer, 'image/jpeg')`

### Content-Type Mapping

| Extension | Content-Type |
|-----------|-------------|
| .md | `text/markdown; charset=utf-8` |
| .jpg | `image/jpeg` |
| .png | `image/png` |
| .json | `application/json` |

### Photo Naming

Use content hash (already computed for deduplication): `{sha256_first12}.jpg`. This gives:
- Deterministic names (same photo = same filename = natural dedup)
- No Cyrillic encoding issues in attachment paths
- Short, predictable paths for Obsidian `![[attachments/abc123def456.jpg]]`

## Throttling and Performance

### Yandex WebDAV Throttling (CRITICAL)

Yandex introduced WebDAV throttling in October 2019: approximately **1 MB per 60 seconds** delay. This is still active as of 2025.

**Impact on this bot:**
- Markdown notes: ~1-5 KB each. Negligible — uploads complete in <1 second.
- Photos: ~100KB-2MB compressed JPEGs. At worst, a 2MB photo takes ~2 minutes. Acceptable for a personal bot.
- Index JSON: ~10-50KB. Negligible.
- NOT uploading videos to vault (already decided in PROJECT.md). This avoids the worst throttling scenarios.

**Mitigation:**
- Compress photos before upload (the bot already optimizes images)
- Don't parallelize uploads — sequential is fine for single-user bot
- Add timeout handling (30s for markdown, 120s for photos)
- Return success message to user immediately after Telegram confirms receipt, upload to WebDAV in background

### REST API Alternative

Yandex also has a REST API (`cloud-api.yandex.net`) with two-step upload (get URL, then PUT). This API also throttles certain MIME types at 128 KiB/s. No advantage over WebDAV for this use case, and adds complexity (two requests per upload). Stick with WebDAV.

## Environment Variables

### Add

| Variable | Value | Purpose |
|----------|-------|---------|
| `YANDEX_DISK_TOKEN` | OAuth token from Yandex | Already in config.ts, just needs `.env` entry |
| `WEBDAV_VAULT_PATH` | `/vault` or `/Obsidian/CollectorBot` | Root path on Yandex.Disk for the vault |

### Remove (after migration)

| Variable | Purpose |
|----------|---------|
| `NOTION_TOKEN` | No longer needed |
| `NOTION_DATABASE_ID` | No longer needed |

## Dependency Changes

### Remove
```bash
npm uninstall @notionhq/client
```

### Add
Nothing. Native fetch covers all WebDAV needs.

## Remotely Save Plugin Compatibility

The bot writes files to Yandex.Disk via WebDAV. Remotely Save reads them on the Obsidian side. They are **independent writers/readers** — no coordination protocol needed. However:

1. **Don't write to `.obsidian/`** — that's Remotely Save's territory
2. **Don't create `_collector_index.json` at vault root** — put it outside the vault path or use a dotfile prefix (`.collector_index.json`) so Obsidian ignores it
3. **Use standard Obsidian filename conventions** — no special characters Obsidian can't handle
4. **Remotely Save has known issues with Yandex.Disk WebDAV** — but that's for bidirectional sync. The bot only writes, Remotely Save only reads bot-created files. One-directional flow avoids the sync bugs.

**Key risk:** If Remotely Save deletes a file from Yandex.Disk (because it was deleted in Obsidian on a device), and the bot's index still references it, the index becomes stale. Mitigation: the bot checks file existence via PROPFIND before assuming it's a duplicate. If the file is gone, re-create it.

## Sources

- [Yandex Disk WebDAV API](https://yandex.com/dev/disk/webdav/) — Official documentation (HIGH confidence)
- [Yandex Disk WebDAV PUT reference](https://yandex.com/dev/disk/doc/dg/reference/put.html) — File upload specs (HIGH confidence)
- [webdav npm package](https://www.npmjs.com/package/webdav) — Evaluated and rejected (HIGH confidence)
- [perry-mitchell/webdav-client GitHub](https://github.com/perry-mitchell/webdav-client) — v5 ESM migration details (HIGH confidence)
- [Remotely Save plugin](https://github.com/remotely-save/remotely-save) — Yandex.Disk compatibility info (MEDIUM confidence)
- [Remotely Save Yandex.Disk docs](https://github.com/remotely-save/remotely-save/blob/master/docs/remote_services/yandexdisk/README.md) — PRO feature details (MEDIUM confidence)
- [rclone Cyrillic filename issue](https://github.com/rclone/rclone/issues/6388) — UTF-8 byte length problems (MEDIUM confidence)
- [Zotero WebDAV Yandex slow](https://forums.zotero.org/discussion/106004/webdav-on-yandex-is-slow) — Throttling confirmation (MEDIUM confidence)
- [DataHoards Yandex FAQ](https://www.datahoards.com/yandex-disk-cloud-storage-faq/) — 1MB/60s throttling detail (LOW confidence — community source)
- [YaDisk known issues](https://yadisk.readthedocs.io/en/stable/known_issues.html) — REST API MIME throttling (MEDIUM confidence)
