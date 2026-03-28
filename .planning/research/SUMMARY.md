# Research Summary: Collector Bot WebDAV Migration

**Domain:** Telegram bot storage migration (Notion API -> Yandex.Disk WebDAV)
**Researched:** 2026-03-28
**Overall confidence:** HIGH

## Executive Summary

Migrating from Notion API to Yandex.Disk WebDAV is straightforward for this use case. The bot needs exactly four HTTP operations (PUT, MKCOL, PROPFIND, GET) which are trivially implemented with Node.js 22's native `fetch` — no library needed. Authentication uses an OAuth token (already configured in the codebase as `YANDEX_DISK_TOKEN`) passed as a single header.

The main technical consideration is Cyrillic filename encoding. Node.js `fetch` does not auto-encode non-ASCII URL characters, so path segments must be encoded with `encodeURIComponent()` per-segment. Filename length must be capped at ~120 Cyrillic characters (240 UTF-8 bytes) to stay within filesystem limits. These are solved problems with well-known patterns.

Yandex.Disk has WebDAV throttling (~1 MB per 60 seconds) active since 2019. For this bot's workload (1-5 KB markdown files, <2 MB compressed photos), throttling is negligible. The single-user, low-frequency nature of the bot means no performance issues are expected.

The only notable risk is interaction with the Remotely Save Obsidian plugin. The bot writes files, Remotely Save syncs them to devices. This one-directional flow avoids the known bidirectional sync bugs. However, if a user deletes a note in Obsidian, the bot's deduplication index could become stale. A PROPFIND existence check before skipping duplicates mitigates this.

## Key Findings

**Stack:** Native fetch for WebDAV, OAuth token auth, `encodeURIComponent()` per path segment, no new npm dependencies.
**Architecture:** Thin `webdav.ts` wrapper (~80-100 lines) replacing `notion.ts`, plus `markdown.ts` for Obsidian-format generation.
**Critical pitfall:** Yandex WebDAV throttling is real but irrelevant for small files. The actual risk is Telegram photo URL expiry — photos must be downloaded and re-uploaded synchronously, not deferred.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **WebDAV Client + Directory Setup** - Build the fetch wrapper, create vault directory structure on Yandex.Disk, verify auth works
   - Addresses: MKCOL for directories, auth validation
   - Avoids: Building on untested infrastructure

2. **Markdown Generation + Text Notes** - Build the markdown/frontmatter generator, wire up text note saving
   - Addresses: Core note creation pipeline (replacing Notion blocks with Obsidian markdown)
   - Avoids: Photo complexity in first pass

3. **Photo Pipeline** - Download from Telegram, upload binary to WebDAV, embed in markdown
   - Addresses: Photo handling (the most architecturally different part from Notion)
   - Avoids: Mixing text and binary concerns

4. **Deduplication + Index** - Implement `_collector_index.json` on Yandex.Disk
   - Addresses: Hash-based dedup replacing Notion database queries
   - Avoids: Data loss from duplicate entries

5. **Cleanup + Cutover** - Remove Notion deps, rename UI text, update config
   - Addresses: Clean separation from old code
   - Avoids: Running both systems simultaneously longer than needed

**Phase ordering rationale:**
- WebDAV client must come first — everything depends on it
- Text notes before photos — simpler, validates the full pipeline with fewer moving parts
- Dedup can come after basic save works — it's an optimization, not a blocker for initial testing
- Cleanup last — keep Notion code available as reference until WebDAV is proven

**Research flags for phases:**
- Phase 1: Standard pattern, no additional research needed
- Phase 3: May need research on Telegram file download timeouts and retry behavior
- Phase 4: Index file corruption recovery if PROPFIND + PUT are not atomic (unlikely for single-user but worth a safety check)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (native fetch for WebDAV) | HIGH | Verified against official Yandex docs, well-documented HTTP protocol |
| Auth (OAuth token) | HIGH | Official Yandex docs confirm format, token already in codebase |
| Cyrillic encoding | HIGH | Known UTF-8 encoding pattern, verified edge cases via rclone issues |
| Throttling impact | MEDIUM | Community reports confirm throttling exists; exact limits for small files not officially documented |
| Remotely Save compatibility | MEDIUM | One-directional write should work, but no direct confirmation of bot-written files syncing correctly |

## Gaps to Address

- Exact throttling behavior for files under 100KB (likely negligible but not officially documented)
- Whether Remotely Save correctly picks up externally-written files on Yandex.Disk without triggering conflict resolution
- OAuth token renewal workflow when the 12-month token expires (manual process — add calendar reminder)
