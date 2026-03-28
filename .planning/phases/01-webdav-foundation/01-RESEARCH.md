# Phase 1: WebDAV Foundation - Research

**Researched:** 2026-03-28
**Domain:** Yandex.Disk WebDAV client implementation (native fetch), directory structure creation, file upload with Cyrillic paths
**Confidence:** HIGH

## Summary

Phase 1 builds the low-level WebDAV client module (`src/services/webdav.ts`) using Node.js 22 native `fetch()` -- no npm dependencies per project constraint. The module needs exactly 4 HTTP methods: PUT (upload), MKCOL (create dir), PROPFIND (check existence), and GET (read files). Authentication is via OAuth token (`Authorization: OAuth <token>`) using the existing `YANDEX_DISK_TOKEN` already in `src/config.ts` line 17. The WebDAV endpoint is `https://webdav.yandex.ru`.

The phase also creates the full vault folder structure (27 category folders + attachments/) on Yandex.Disk at startup. MKCOL cannot create nested paths in one call -- each parent must exist first. A recursive `ensureDir()` with an in-memory cache (`Set<string>`) avoids redundant calls and handles the 409 Conflict / 405 Already Exists responses correctly.

Key risks: Yandex returns HTTP 202 (async processing) on some PUTs, which means the file is not immediately available. The retry layer must handle 429 rate limits, 500/503 transient errors with exponential backoff, and the 202 polling pattern for upload confirmation. Cyrillic path segments must be individually percent-encoded via `encodeURIComponent()` with `/` separators preserved.

**Primary recommendation:** Build `webdav.ts` as a focused ~100-line module with `putFile`, `ensureDir`, `exists`, `getFile` exports. Test auth first with a PROPFIND on `/` before building anything else. Create all 27 vault folders at bot startup, not lazily.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WDAV-01 | Bot authenticates with Yandex.Disk via WebDAV with OAuth token | OAuth header format confirmed: `Authorization: OAuth y3_...`. Token already in config.ts line 17. Endpoint: `https://webdav.yandex.ru` |
| WDAV-02 | Bot creates directories via MKCOL with caching | MKCOL returns 201 (created), 405 (exists). Must create parents first (409 on missing parent). Cache created dirs in `Set<string>`. |
| WDAV-03 | Bot uploads text files with correct Cyrillic encoding | PUT with `Content-Type: text/markdown; charset=utf-8`. Path segments encoded via `encodeURIComponent()`. Returns 201/204. |
| WDAV-04 | Bot uploads binary files (photos) via PUT | PUT with `Content-Type: image/jpeg`, body as Buffer. Same path encoding. May return 202 (async) -- poll until confirmed. |
| WDAV-05 | Bot checks file existence via PROPFIND | PROPFIND with `Depth: 0` header. 207 = exists, 404 = not found. No XML parsing needed for existence checks. |
| WDAV-06 | Bot retries failed requests with exponential backoff | Retry on 429, 500, 502, 503, 504, network errors. Base delay 1s, factor 2x, max 3 attempts. |
| FOLD-01 | Vault contains 27 category folders + attachments/ | Full tree: vault/ with Бизнес/(7 subs), Ландшафт/(3), ТОС/(3), Семья/(2), Рецепты/(4), Новости/, Идеи/, Inbox/, attachments/ |
| FOLD-02 | All folders created at first startup via MKCOL | `ensureDir()` called for each of 28 paths at startup. Idempotent -- safe to run repeatedly. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **No new npm dependencies**: WebDAV via native `fetch()`, no `webdav` package
- **TypeScript**: All source in `src/`, ES modules, strict mode
- **Node.js 22**: Runtime with native fetch support
- **Single user**: No concurrency concerns
- **Cyrillic**: Filenames and folder names in Russian, need sanitization
- **Existing stack**: grammy, dotenv -- unchanged
- **ESM**: `"type": "module"` in package.json, `.js` extensions in imports

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Node.js 22 built-in | WebDAV HTTP operations (PUT, MKCOL, PROPFIND, GET) | Project constraint: no new deps. Only 4 HTTP methods needed. |
| `node:crypto` | Node.js 22 built-in | Content hashing (already used in `content-hash.ts`) | Existing dependency, reuse as-is |
| `node:buffer` | Node.js 22 built-in | Binary file handling for photo uploads | Built-in, no install needed |

### Supporting

No additional libraries needed. The entire WebDAV client is ~100 lines wrapping native fetch.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch | `webdav` npm v5 | ESM-only, 15+ transitive deps, overkill for 4 operations. Rejected per project constraint. |
| Native fetch | `ya-disk` npm | REST API wrapper (not WebDAV), dead project. |
| Manual retry | `p-retry` npm | Adds dependency for 15 lines of code. Not worth it. |

## Architecture Patterns

### New Module Structure

```
src/
  services/
    webdav.ts          # NEW: Low-level WebDAV client (PUT, MKCOL, PROPFIND, GET, retry)
    notion.ts          # EXISTING: Untouched in Phase 1
  utils/
    text-utils.ts      # EXISTING: Will add sanitizeFilename() in Phase 2
    content-hash.ts    # EXISTING: Reuse as-is
  config.ts            # EXISTING: Add WEBDAV_URL, VAULT_PATH exports
```

### Pattern 1: WebDAV Client as Thin HTTP Wrapper

**What:** A module exporting 4-5 async functions that wrap `fetch()` with auth headers, path encoding, error handling, and retry logic. No classes, no state beyond a dir cache Set.

**When to use:** Always -- this is the only WebDAV pattern for this project.

**Example:**
```typescript
// src/services/webdav.ts
const WEBDAV_BASE = 'https://webdav.yandex.ru'
const dirCache = new Set<string>()

function encodePath(path: string): string {
  return path
    .split('/')
    .map(seg => seg ? encodeURIComponent(seg) : '')
    .join('/')
}

function authHeaders(): Record<string, string> {
  return { 'Authorization': `OAuth ${YANDEX_DISK_TOKEN}` }
}

export async function putFile(
  path: string,
  content: Buffer | string,
  contentType = 'text/markdown; charset=utf-8'
): Promise<void> {
  const url = `${WEBDAV_BASE}${encodePath(path)}`
  const res = await withRetry(() =>
    fetch(url, {
      method: 'PUT',
      headers: {
        ...authHeaders(),
        'Content-Type': contentType,
      },
      body: content,
    })
  )
  if (res.status === 202) {
    // Yandex async processing -- poll until file exists
    await pollUntilExists(path)
  } else if (res.status !== 201 && res.status !== 204) {
    throw new WebDAVError(res.statusText, res.status, 'PUT', path)
  }
}
```

### Pattern 2: Recursive ensureDir with Cache

**What:** Split path into segments, MKCOL each level, cache in a Set. Tolerate 405 (already exists).

**Example:**
```typescript
export async function ensureDir(path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  let current = ''
  for (const seg of segments) {
    current += '/' + seg
    if (dirCache.has(current)) continue
    const url = `${WEBDAV_BASE}${encodePath(current)}`
    const res = await fetch(url, {
      method: 'MKCOL',
      headers: authHeaders(),
    })
    // 201 = created, 405 = already exists, both OK
    if (res.status !== 201 && res.status !== 405) {
      throw new WebDAVError(res.statusText, res.status, 'MKCOL', current)
    }
    dirCache.add(current)
  }
}
```

### Pattern 3: Retry with Exponential Backoff

**What:** Generic retry wrapper for all WebDAV operations. Retries on network errors, 429, 5xx.

**Example:**
```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await operation()
      // If Response, check for retryable status
      if (res instanceof Response) {
        const { status } = res
        if (status === 429 || (status >= 500 && status <= 504)) {
          if (attempt === maxRetries) return res
          const delay = baseDelay * Math.pow(2, attempt - 1)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
      }
      return res
    } catch (err) {
      if (attempt === maxRetries) throw err
      const delay = baseDelay * Math.pow(2, attempt - 1)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}
```

### Anti-Patterns to Avoid

- **Generic StorageService interface:** No abstraction layer. There will never be a third backend. Replace notion.ts directly in Phase 3.
- **XML parsing library for PROPFIND:** For existence checks, only the HTTP status code matters (207 vs 404). No XML parsing needed.
- **Parallel MKCOL calls:** MKCOL for nested paths must be sequential (parent before child). Do not `Promise.all()` the folder creation.
- **Double URL encoding:** `encodeURIComponent` on already-encoded strings produces `%25D0%25...`. Encode once, at the boundary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL path encoding | Custom percent-encoding | `encodeURIComponent()` per segment | Edge cases with unicode normalization forms, reserved chars |
| Retry logic | Per-call retry code | Single `withRetry()` wrapper | Consistency, single place to tune delays |
| Content hashing | New hash function | Existing `contentHash()` in `content-hash.ts` | Already works, tested in production |

## Common Pitfalls

### Pitfall 1: HTTP 202 Accepted on PUT (Async Upload)

**What goes wrong:** Yandex returns 202 instead of 201 for some uploads. File is NOT available immediately -- server is still processing (hash calculation). Referencing the file before it's ready gives 404.
**Why it happens:** Yandex processes uploads asynchronously, especially for larger files.
**How to avoid:** After any 202 response, poll with PROPFIND `Depth: 0` on the path until 207 (exists). Start at 500ms, backoff to 10s, timeout at 30s.
**Warning signs:** 202 in PUT response logs. Test with a 5MB+ file to trigger.
**Confidence:** HIGH -- rclone issues, Zotero forums, Total Commander forums confirm.

### Pitfall 2: MKCOL Cannot Create Nested Paths

**What goes wrong:** MKCOL `/vault/Бизнес/WB/` fails with 409 if `/vault/Бизнес/` doesn't exist.
**Why it happens:** WebDAV spec (RFC 4918) requires each parent to exist.
**How to avoid:** `ensureDir()` creates each level sequentially. Cache results in a Set.
**Warning signs:** 409 Conflict on MKCOL.
**Confidence:** HIGH -- WebDAV standard behavior, confirmed in Yandex docs.

### Pitfall 3: Cyrillic Path Encoding

**What goes wrong:** `fetch()` in Node.js does NOT auto-encode non-ASCII in URLs. Passing `https://webdav.yandex.ru/vault/Рецепты/` directly causes malformed request or 400 error.
**Why it happens:** `fetch` expects a valid URL. Cyrillic chars are not valid in URL path without encoding.
**How to avoid:** `encodePath()` splits on `/`, applies `encodeURIComponent()` to each segment, rejoins. Never construct URLs by hand.
**Warning signs:** 400 Bad Request or 404 on paths that should exist.
**Confidence:** HIGH -- standard HTTP/URL behavior.

### Pitfall 4: 429 Rate Limiting

**What goes wrong:** Rapid WebDAV operations trigger Yandex throttling. No published rate limit -- opaque and changes without notice.
**Why it happens:** Yandex throttles WebDAV since 2019, ~1MB per 60s delay for large files.
**How to avoid:** Retry with exponential backoff on 429. Space operations naturally (sequential, not parallel). For Phase 1, folder creation at startup is a burst of ~28 MKCOL calls -- most will be 405 (already exists) which is fast, but initial creation may hit limits.
**Warning signs:** 429 in response logs.
**Confidence:** HIGH -- multiple independent sources confirm.

### Pitfall 5: 500/503 Transient Server Errors

**What goes wrong:** Yandex.Disk sporadically returns 500/503. Transient, resolves on retry.
**Why it happens:** Consumer infrastructure, documented instability since 2019.
**How to avoid:** Retry all 5xx with backoff. Max 3 attempts.
**Warning signs:** Intermittent 500/503 in logs.
**Confidence:** HIGH.

### Pitfall 6: MKCOL 405 vs 409 Distinction

**What goes wrong:** MKCOL returns 405 Method Not Allowed when directory already exists. Some implementations incorrectly treat this as an error.
**Why it happens:** WebDAV spec says MKCOL on existing resource is 405.
**How to avoid:** In `ensureDir()`, treat both 201 and 405 as success.
**Warning signs:** Error logs for "already exists" directories.
**Confidence:** HIGH -- RFC 4918.

## Code Examples

### Full Vault Folder Structure (28 paths)

```typescript
// All paths relative to VAULT_PATH (e.g. "/vault")
const VAULT_FOLDERS = [
  '',                           // vault root
  '/Бизнес',
  '/Бизнес/WB',
  '/Бизнес/Ozon',
  '/Бизнес/Поставщики',
  '/Бизнес/Финансы',
  '/Бизнес/Аналитика',
  '/Бизнес/Контент',
  '/Бизнес/Налоги',
  '/Ландшафт',
  '/Ландшафт/Растения',
  '/Ландшафт/Проекты',
  '/Ландшафт/Благоустройство',
  '/ТОС',
  '/ТОС/Документы',
  '/ТОС/Протоколы',
  '/ТОС/Инициативы',
  '/Семья',
  '/Семья/Дети',
  '/Семья/Дом',
  '/Рецепты',
  '/Рецепты/Супы',
  '/Рецепты/Мясо',
  '/Рецепты/Выпечка',
  '/Рецепты/Напитки',
  '/Новости',
  '/Идеи',
  '/Inbox',
  '/attachments',
]

// At startup:
async function initVault(): Promise<void> {
  for (const folder of VAULT_FOLDERS) {
    await ensureDir(`${VAULT_PATH}${folder}`)
  }
  console.log(`[WEBDAV] Vault structure verified: ${VAULT_FOLDERS.length} folders`)
}
```

### WebDAV Error Class

```typescript
export class WebDAVError extends Error {
  constructor(
    message: string,
    public status: number,
    public method: string,
    public path: string
  ) {
    super(`WebDAV ${method} ${path}: ${status} ${message}`)
    this.name = 'WebDAVError'
  }
}
```

### exists() via PROPFIND

```typescript
export async function exists(path: string): Promise<boolean> {
  const url = `${WEBDAV_BASE}${encodePath(path)}`
  const res = await withRetry(() =>
    fetch(url, {
      method: 'PROPFIND',
      headers: {
        ...authHeaders(),
        'Depth': '0',
      },
    })
  )
  if (res.status === 207) return true
  if (res.status === 404) return false
  throw new WebDAVError(res.statusText, res.status, 'PROPFIND', path)
}
```

### Config Additions

```typescript
// src/config.ts -- add these exports
export const WEBDAV_URL = 'https://webdav.yandex.ru'
export const VAULT_PATH = process.env.VAULT_PATH || '/vault'
// YANDEX_DISK_TOKEN already exists at line 17, but change from optional to required:
export const YANDEX_DISK_TOKEN = required('YANDEX_DISK_TOKEN')
```

### Auth Verification (First Thing to Test)

```typescript
// Quick auth check -- run before anything else
async function verifyAuth(): Promise<void> {
  const res = await fetch(`${WEBDAV_URL}/`, {
    method: 'PROPFIND',
    headers: {
      'Authorization': `OAuth ${YANDEX_DISK_TOKEN}`,
      'Depth': '0',
    },
  })
  if (res.status === 401) {
    throw new Error('WebDAV auth failed: invalid or expired YANDEX_DISK_TOKEN')
  }
  if (res.status !== 207) {
    throw new Error(`WebDAV auth check unexpected status: ${res.status}`)
  }
  console.log('[WEBDAV] Authentication verified')
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `webdav` npm v4 (CJS) | `webdav` npm v5 (ESM-only) | 2023 | Would force ESM migration if used. Moot -- project uses native fetch. |
| Basic Auth for Yandex WebDAV | OAuth token preferred | Ongoing | OAuth is simpler (one token) and doesn't require 2FA app passwords. |
| Yandex REST API for uploads | WebDAV PUT directly | N/A | REST API adds complexity (two-step upload) with no benefit for this use case. |

## Open Questions

1. **VAULT_PATH default value**
   - What we know: The spec says "vault/" but actual Yandex.Disk path could be "/vault", "/Obsidian/CollectorVault", or any custom path.
   - What's unclear: What path the user will configure on Yandex.Disk.
   - Recommendation: Default to `/vault` in env, let user override via `VAULT_PATH`. Document in .env.example.

2. **202 Polling frequency for small files**
   - What we know: 202 is documented for large files (5MB+). Unclear if it ever happens for small text files (<5KB).
   - What's unclear: Exact threshold for async processing.
   - Recommendation: Implement polling but expect it to rarely trigger for markdown files. Log when it does.

## Sources

### Primary (HIGH confidence)
- [Yandex Disk WebDAV API](https://yandex.com/dev/disk/webdav/) -- endpoint, auth format, method specs
- [Yandex MKCOL reference](https://yandex.com/dev/disk/doc/dg/reference/mkcol.html) -- 409 on missing parent confirmed
- [RFC 4918](http://www.webdav.org/specs/rfc4918.html) -- WebDAV protocol specification

### Secondary (MEDIUM confidence)
- [rclone issue #8994](https://github.com/rclone/rclone/issues/8994) -- 202 async upload behavior confirmed
- [rclone issue #6145](https://github.com/rclone/rclone/issues/6145) -- upload failures with WebDAV servers
- [Remotely Save issues #869, #1026](https://github.com/remotely-save/remotely-save/issues/869) -- 429 rate limiting confirmed
- [Zotero forum](https://forums.zotero.org/discussion/106004/webdav-on-yandex-is-slow) -- throttling behavior confirmed

### Tertiary (LOW confidence)
- [DataHoards Yandex FAQ](https://www.datahoards.com/) -- 1MB/60s throttling detail (community source, not officially verified)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- native fetch is confirmed working for custom HTTP methods in Node 22. No library needed.
- Architecture: HIGH -- all prior research (STACK.md, ARCHITECTURE.md, PITFALLS.md) aligns and has been cross-verified.
- Pitfalls: HIGH -- multiple independent sources confirm all listed pitfalls.

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable domain, Yandex WebDAV API has not changed significantly in years)
