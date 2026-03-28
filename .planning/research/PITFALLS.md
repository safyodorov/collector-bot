# Domain Pitfalls: Yandex.Disk WebDAV Integration

**Domain:** Telegram bot storage migration (Notion API to Yandex.Disk WebDAV / Obsidian vault)
**Researched:** 2026-03-28
**Overall confidence:** MEDIUM-HIGH (well-documented community issues, verified across multiple independent sources)

## Critical Pitfalls

Mistakes that cause data loss, broken sync, or require architectural rework.

### Pitfall 1: HTTP 202 Accepted on PUT — Silent Upload Failure

**What goes wrong:** Yandex.Disk WebDAV returns `202 Accepted` instead of `201 Created` for PUT uploads. This means the server received the data but has NOT finished processing it. If you treat 202 as success and immediately reference the file (e.g., in a markdown note), the file may not exist yet. Subsequent PROPFIND or GET will return 404.

**Why it happens:** Yandex processes uploads asynchronously, especially for larger files. After receiving the bytes, the server calculates a hash. For a 10MB photo this can take seconds; for larger files, minutes. The 202 is non-standard for WebDAV PUT and most clients don't expect it.

**Consequences:** Photos uploaded to `attachments/` are referenced in markdown via `![[attachments/hash.jpg]]` but the file doesn't exist yet when Remotely Save pulls. Obsidian shows broken image embeds. The user sees a note with missing photos. Worse: if dedup index is updated assuming success, a retry won't re-upload.

**Prevention:**
1. After any PUT that returns 202, poll with HEAD or PROPFIND on the uploaded path until you get 200/207, with exponential backoff (start 500ms, max 10s, timeout after 30s).
2. Only update the dedup index AFTER confirming the file exists.
3. For photos specifically: upload the attachment first, confirm it exists, then upload the markdown note. Never reverse this order.

**Detection:** Log all PUT response codes. Any 202 in logs means the async path is being hit. Test with a 5MB+ photo to trigger it reliably.

**Phase:** Phase 1 (WebDAV client implementation). This must be built into the core PUT wrapper from day one.

**Confidence:** HIGH — documented in rclone issues (#8994), Zotero forums, Total Commander forums. Multiple independent confirmations.

### Pitfall 2: Yandex WebDAV 429 Rate Limiting Kills Sync

**What goes wrong:** Yandex.Disk returns `429 Too Many Requests` when too many WebDAV operations happen in quick succession. This affects both the bot's direct writes AND Remotely Save's sync operations. Vaults with 300+ files trigger 429 during Remotely Save sync. The bot doing rapid PUT operations (photo + markdown + index update = 3 requests per save) can also trigger it.

**Why it happens:** Since 2019, Yandex has been throttling WebDAV. The throttle reportedly introduces a 60-second delay per megabyte of data. Rapid PROPFIND requests (which Remotely Save does to check for changes) are also throttled. There is no published rate limit — it's opaque and changes without notice.

**Consequences:** Bot saves fail mid-operation. If the markdown note was uploaded but the index update was throttled, the index becomes stale. Remotely Save sync breaks entirely with 429 errors, meaning the user's Obsidian on mobile/desktop stops receiving new notes.

**Prevention:**
1. Space WebDAV operations: minimum 500ms between requests. For photo uploads (larger payloads), wait 2-3 seconds before the next operation.
2. Implement retry with exponential backoff: 1s, 2s, 4s, 8s, max 3 retries on 429.
3. Keep the vault small. Avoid uploading large files (videos) to the vault. The project already plans to keep videos outside the vault — enforce this strictly.
4. Batch-minimize operations per save: upload photo, upload markdown, update index = 3 ops minimum. Don't add extras (PROPFIND for directory existence on every save — do it once at startup).

**Detection:** Monitor for 429 in response codes. If 429 rate increases, the vault is growing too large or Yandex tightened throttling.

**Phase:** Phase 1 (WebDAV client). Retry logic with backoff must be in the WebDAV client layer, not the business logic.

**Confidence:** HIGH — Remotely Save issues #869, #1026, #1034; multiple Zotero forum threads; rclone issue #6145.

### Pitfall 3: Remotely Save and Bot Writing to Same Vault — Sync Conflicts

**What goes wrong:** The bot writes files directly to Yandex.Disk via WebDAV. Remotely Save on the user's device syncs the same vault via WebDAV. Neither knows about the other's writes. When Remotely Save syncs, it sees files it didn't create and may treat them as conflicts or, worse, overwrite/delete them based on modification time comparison.

**Why it happens:** Remotely Save uses `last modified time` to decide which version wins. The bot's PUT operations set server-side mtime. Remotely Save tracks local mtime. If Remotely Save's last sync was before the bot wrote a file, it may see the new file as a remote addition (good) or as a conflict with a local deletion (bad — if the user deleted something locally). The free version of Remotely Save has no content merge — it picks newer or larger.

**Consequences:** New notes from the bot might be deleted if Remotely Save decides local state (which doesn't have them) is authoritative. The `_collector_index.json` file is especially vulnerable — both the bot and Remotely Save touch it, and a stale version could cause duplicate saves or missed deduplication.

**Prevention:**
1. The bot should ONLY write files, never delete or update existing files in the vault (append-only pattern). This way Remotely Save always sees new remote files that don't conflict with anything local.
2. Prefix all bot-created files clearly: `collector/` subfolder for all bot content. This isolates the bot's files from user-created Obsidian notes.
3. For the dedup index: store it in a path Remotely Save won't sync, or accept that it's bot-only state. Alternative: encode the content hash in the filename itself (e.g., `2026-03-28_Шарлотка_a1b2c3.md`) and check for filename patterns via PROPFIND instead of maintaining an index file.
4. Configure Remotely Save to NOT delete remote files that don't exist locally. Check plugin settings for "skip deletion" or similar.

**Detection:** After first deployment, create a test note via bot, then sync with Remotely Save on a device. Check that the note appears. Then create a note in Obsidian, sync, and verify the bot's next save doesn't conflict.

**Phase:** Phase 1 (architecture decision) and Phase 2 (integration testing with Remotely Save). The file naming / folder structure decision is architectural and must be made before writing any code.

**Confidence:** MEDIUM — no direct documentation of this exact scenario (bot + Remotely Save), but the conflict model is well-understood from Remotely Save's documented behavior.

### Pitfall 4: Photo Binary Upload — Download-Before-Expiry Race Condition

**What goes wrong:** Telegram Bot API file URLs expire after ~1 hour. The current code gets a file URL and passes it to Notion (which fetches immediately). With WebDAV, the bot must: (1) get file URL from Telegram, (2) download the photo bytes, (3) PUT to Yandex.Disk. If step 3 fails (429, 500, network error) and the bot retries after the URL expired, the photo is lost.

**Why it happens:** Telegram file URLs are temporary. The download-upload pipeline is not atomic. Any failure between download and successful upload leaves the photo in limbo.

**Consequences:** Notes saved without their photos. The markdown references `![[attachments/hash.jpg]]` but the file was never uploaded. The user sees broken images in Obsidian.

**Prevention:**
1. Download the photo to a local temp file IMMEDIATELY when the message arrives, before any categorization flow. Don't wait for the user to finish selecting categories.
2. Store the local temp path in the session state alongside other metadata.
3. Upload to WebDAV from the local temp file. If WebDAV upload fails, retry from the local file (no Telegram URL needed).
4. Clean up temp files only after confirmed WebDAV upload (201 response, not 202 — see Pitfall 1).

**Detection:** Check for notes in the vault with `![[attachments/...]]` where the referenced attachment doesn't exist.

**Phase:** Phase 1 (photo pipeline redesign). This changes the message handling flow — photos must be downloaded eagerly.

**Confidence:** HIGH — the Telegram URL expiry is documented, the current code's reliance on it is confirmed in CONCERNS.md.

## Moderate Pitfalls

### Pitfall 5: Cyrillic Filenames — UTF-8 Byte Length Overflow

**What goes wrong:** Cyrillic characters are 2 bytes each in UTF-8. A filename of 150 Cyrillic characters = 300 bytes, exceeding the 255-byte limit on EXT4 (the VPS filesystem) and many WebDAV implementations. The `autoTitle` function generates titles up to 60 characters, but combined with date prefix (`2026-03-28_`) and `.md` extension, plus folder path encoding, the total can exceed limits.

**Why it happens:** NTFS allows 255 characters (UTF-16, so 510 bytes). EXT4 allows 255 bytes (UTF-8). Yandex.Disk's internal filesystem limits are undocumented. When the bot creates a file with a long Cyrillic name, the server may reject it or truncate silently.

**Prevention:**
1. `sanitizeFilename()` must limit output to **100 bytes** (not characters) after UTF-8 encoding. This leaves room for the date prefix (11 bytes), extension (3 bytes), separator (1 byte), and WebDAV percent-encoding overhead.
2. Measure byte length with `Buffer.byteLength(name, 'utf8')`, not `name.length`.
3. When truncating, cut at a character boundary (don't split a multi-byte sequence).

**Detection:** Test with a very long Russian title (60+ Cyrillic chars). If PUT returns 400 or 500, the filename is too long.

**Phase:** Phase 1 (utility function). Simple to implement but easy to get wrong.

**Confidence:** HIGH — documented in yandex-disk-indicator wiki, well-known Linux filesystem constraint.

### Pitfall 6: Cyrillic URL Percent-Encoding in WebDAV Paths

**What goes wrong:** WebDAV paths must be percent-encoded in HTTP requests. `Рецепты/2026-03-28_Шарлотка.md` becomes `%D0%A0%D0%B5%D1%86%D0%B5%D0%BF%D1%82%D1%8B/2026-03-28_%D0%A8%D0%B0%D1%80%D0%BB%D0%BE%D1%82%D0%BA%D0%B0.md`. If encoding is wrong (double-encoded, wrong encoding, or path separators encoded), Yandex returns 404.

**Why it happens:** JavaScript's `encodeURIComponent()` encodes everything including `/`. You must encode path segments individually, not the whole path. Also, some special characters in titles (parentheses, brackets, apostrophes) may or may not need encoding depending on the WebDAV server.

**Prevention:**
1. Split the path by `/`, encode each segment with `encodeURIComponent()`, rejoin with `/`.
2. Test with Cyrillic folder names AND Cyrillic filenames together.
3. Write a `encodeWebDAVPath(path)` utility and use it everywhere. Never hand-encode.

**Detection:** PROPFIND returns 404 for a path you just PUT to. Check the encoded URL in logs.

**Phase:** Phase 1 (WebDAV client utility).

**Confidence:** HIGH — standard WebDAV encoding issue, documented in sabre/dav and WebDAV RFC.

### Pitfall 7: MKCOL for Nested Directories Must Be Sequential

**What goes wrong:** WebDAV MKCOL (create directory) fails if the parent directory doesn't exist. Unlike `mkdir -p`, you can't create `vault/Рецепты/attachments/` in one call. You must create `vault/`, then `vault/Рецепты/`, then `vault/Рецепты/attachments/`.

**Why it happens:** WebDAV MKCOL is specified to return `409 Conflict` when intermediate collections are missing. Yandex.Disk follows this behavior.

**Prevention:**
1. Implement `ensureDirectory(path)` that splits the path and creates each segment, catching `405 Method Not Allowed` (already exists) silently.
2. Cache which directories have been confirmed to exist (in-memory Set). Only MKCOL once per directory per bot session.
3. Create all category folders at bot startup, not at save time. This avoids the race of first-save-to-new-category failing.

**Detection:** MKCOL returns 409. Check that parent path exists.

**Phase:** Phase 1 (WebDAV client). Must be in place before any PUT operations.

**Confidence:** HIGH — standard WebDAV behavior per RFC 4918.

### Pitfall 8: Yandex WebDAV Authentication — App Password Required

**What goes wrong:** Regular Yandex account password doesn't work for WebDAV if 2FA is enabled (and Yandex increasingly pushes 2FA). Connection fails with "wrong user or password" even though credentials work on the website.

**Why it happens:** With 2FA enabled, Yandex requires app-specific passwords for third-party access. The app password must be created specifically for "Files/WebDAV" access type — a mail app password won't work for disk.

**Prevention:**
1. Document clearly in deployment instructions: create an app password at `https://passport.yandex.ru/profile` specifically for WebDAV/Disk.
2. Use OAuth token (`Authorization: OAuth <token>`) instead of Basic auth if possible — the project already has `YANDEX_DISK_TOKEN` in config.ts. OAuth tokens bypass the app-password issue entirely.
3. Test authentication FIRST in Phase 1, before building anything else. A simple PROPFIND on `/` should return 207.

**Detection:** PUT/PROPFIND returns 401 Unauthorized. The config already reads `YANDEX_DISK_TOKEN` — verify it's an OAuth token, not an account password.

**Phase:** Phase 0 (setup/verification). Must be confirmed working before any development.

**Confidence:** HIGH — documented across Zotero, Cryptomator, KeePass2Android forums.

### Pitfall 9: HTTP 500/503 Intermittent Server Errors

**What goes wrong:** Yandex.Disk WebDAV sporadically returns 500 Internal Server Error and 503 Service Unavailable. These are transient and resolve on retry, but without retry logic, every occurrence is a user-visible failure.

**Why it happens:** Yandex.Disk is consumer infrastructure, not enterprise SaaS. Server-side instability has been documented consistently since 2019. Yandex's official stance: "We did not change anything on our servers."

**Prevention:**
1. Retry all 5xx errors with exponential backoff: 1s, 2s, 4s. Max 3 attempts.
2. Distinguish between 5xx (retry) and 4xx (don't retry, except 429).
3. Implement a local file-based queue (as suggested in CONCERNS.md): on persistent failure after retries, write the save payload to a local JSON file. On next successful save, drain the queue.

**Detection:** Log all response codes. Track 5xx frequency over time. If it exceeds 10% of requests, consider the migration plan's viability.

**Phase:** Phase 1 (WebDAV client retry logic).

**Confidence:** HIGH — documented across all sources surveyed.

## Minor Pitfalls

### Pitfall 10: YAML Frontmatter Special Characters

**What goes wrong:** Cyrillic titles containing YAML-special characters (`:`, `#`, `[`, `]`, `{`, `}`, `"`, `'`) break frontmatter parsing. `title: Рецепт: Шарлотка` makes YAML treat "Шарлотка" as a separate mapping value.

**Prevention:** Always quote string values in frontmatter: `title: "Рецепт: Шарлотка"`. Escape internal quotes. Use a YAML serialization library or a simple template with guaranteed quoting.

**Phase:** Phase 1 (markdown generator).

**Confidence:** HIGH — standard YAML behavior.

### Pitfall 11: Obsidian Filename Restrictions Beyond OS Limits

**What goes wrong:** Obsidian has its own filename restrictions beyond the OS: no `*`, `"`, `\`, `/`, `<`, `>`, `:`, `|`, `?`. Some of these (like `:`) commonly appear in Russian text (time references, recipe names). If the bot creates a file with these characters, Obsidian can't open it.

**Prevention:** Strip ALL of these characters in `sanitizeFilename()`, not just OS-restricted ones. Replace with space or dash.

**Phase:** Phase 1 (utility function).

**Confidence:** HIGH — documented in Obsidian help.

### Pitfall 12: Remotely Save Doesn't Sync in Background

**What goes wrong:** Remotely Save only syncs when Obsidian is open and in the foreground. On mobile, closing Obsidian stops sync entirely. The user might save content via bot but not see it for hours/days until they open Obsidian.

**Prevention:** This is a UX expectation issue, not a bug. Document it for the user. The bot saves to Yandex.Disk immediately; Obsidian picks it up on next open+sync. Optionally: set Remotely Save to auto-sync on startup.

**Phase:** Not a code issue — documentation/setup note.

**Confidence:** HIGH — confirmed in Remotely Save docs and README.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| WebDAV client (Phase 1) | 202 async uploads, 429 throttling, 500/503 errors | Retry logic with backoff, poll for upload confirmation |
| Photo pipeline (Phase 1) | Telegram URL expiry before WebDAV upload completes | Download photos eagerly to temp file on message receive |
| Filename handling (Phase 1) | UTF-8 byte overflow, Obsidian-illegal chars, encoding | `sanitizeFilename()` with byte-length check + full char stripping |
| Directory structure (Phase 1) | MKCOL needs parent dirs, 409 on missing parents | `ensureDirectory()` with sequential creation + caching |
| Dedup index (Phase 1) | Remotely Save conflicts on shared `_collector_index.json` | Encode hash in filename OR isolate index from sync |
| Remotely Save integration (Phase 2) | 429 from vault size, conflicts on bot-created files | Keep vault small, bot writes are append-only, test sync flow |
| Authentication (Phase 0) | Wrong password type, OAuth vs Basic confusion | Verify PROPFIND on `/` returns 207 before any development |
| Markdown generation (Phase 1) | YAML frontmatter broken by special chars | Always quote strings, test with colons and brackets in titles |

## Architecture Recommendations to Avoid Multiple Pitfalls

Several pitfalls can be mitigated with one architectural decision:

**Encode content hash in filename instead of maintaining an index file.**
Format: `2026-03-28_Шарлотка_a1b2c3.md` (last 6 chars of SHA-256).
Benefits: eliminates Pitfall 3 (index file conflicts with Remotely Save), simplifies dedup to a PROPFIND + filename pattern match, removes a write operation per save (no index PUT), and is human-readable in Obsidian.
Cost: PROPFIND on the target folder to list files. For a few hundred files this is fine; for thousands it would be slow. Given single-user bot adding a few notes per day, this scales for years.

**Download photos eagerly, upload last.**
On message receive: download photo to `/tmp/`. During category selection: photo is safe locally. On save: upload photo first (confirm 201), then upload markdown. This ordering prevents both Pitfall 1 (async upload) and Pitfall 4 (URL expiry) from causing broken image references.

## Sources

- [Yandex Disk WebDAV API docs](https://yandex.com/dev/disk/webdav/)
- [Zotero forum: WebDAV sync problems](https://forums.zotero.org/discussion/64374/report-id-1667694800-problem-with-webdav-syncronization-yandex-disk)
- [Zotero forum: WebDAV on Yandex is slow](https://forums.zotero.org/discussion/106004/webdav-on-yandex-is-slow)
- [Remotely Save issue #869: v0.5.25 Yandex sync broken](https://github.com/remotely-save/remotely-save/issues/869)
- [Remotely Save issue #1026: 429 Too Many Requests](https://github.com/remotely-save/remotely-save/issues/1026)
- [Remotely Save PR #1034: Yandex 429 fix](https://github.com/remotely-save/remotely-save/pull/1034)
- [rclone issue #8994: 404 after successful upload to Yandex](https://github.com/rclone/rclone/issues/8994)
- [rclone issue #6145: upload failures with WebDAV servers](https://github.com/rclone/rclone/issues/6145)
- [yandex-disk-indicator: known bugs (Cyrillic filename length)](https://github.com/slytomcat/yandex-disk-indicator/wiki/Known-bugs-and-features)
- [sabre/dav: WebDAV character encoding](https://sabre.io/dav/character-encoding/)
- [Remotely Save GitHub repo](https://github.com/remotely-save/remotely-save)
- [Remotely Save Yandex Disk docs](https://github.com/remotely-save/remotely-save/blob/master/docs/remote_services/yandexdisk/README.md)
- [Buttercup: Yandex WebDAV connection issue](https://github.com/buttercup/buttercup-desktop/issues/206)
- [Total Commander: Yandex upload stuck at 99%](https://www.ghisler.ch/board/viewtopic.php?t=54226)
- [Cryptomator: Yandex login with 2FA](https://community.cryptomator.org/t/yandex-disk-login-troubles/6511)

---

*Pitfalls audit: 2026-03-28*
