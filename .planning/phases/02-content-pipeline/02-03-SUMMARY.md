---
phase: 02-content-pipeline
plan: 03
subsystem: content-pipeline
tags: [webdav, storage, state-machine, photo-download, dedup, obsidian, grammy]

requires:
  - phase: 01-webdav-foundation
    provides: WebDAV putFile/exists for file operations
  - phase: 02-content-pipeline plan 01
    provides: buildMarkdown, NoteData, sanitizeFilename, buildFilename, CATEGORY_MAP, CATEGORY_TAGS, ContentType
  - phase: 02-content-pipeline plan 02
    provides: buildCategoryKeyboard, buildSubcategoryKeyboard, buildTagKeyboard, buildTitleKeyboard, buildDuplicateKeyboard
provides:
  - saveEntry orchestrator (uploads photos then markdown to Yandex.Disk)
  - findDuplicate via WebDAV PROPFIND existence check
  - Full 6-state bot state machine (idle, awaiting_category, awaiting_subcategory, awaiting_tags, awaiting_custom_tags, awaiting_title)
  - Immediate photo download and module-level buffer storage
  - Inbox quick-save without tags or title
  - Duplicate detection with save-new/cancel UI
affects: [03-cutover-deploy]

tech-stack:
  added: []
  patterns: [module-level Map for photo buffers, state machine with callback routing, orchestrator pattern for save pipeline]

key-files:
  created: [src/services/storage.ts]
  modified: [src/bot.ts]

key-decisions:
  - "Photos stored in module-level Map<number, Buffer[]> keyed by chat.id, not in grammY session"
  - "Dedup happens after title input (when filename is known), not on content receipt"
  - "Inbox quick-save bypasses tags and title prompts entirely"
  - "Callback data prefixes: nav: for navigation, tag: for tags, title: for title, dup: for dedup"

patterns-established:
  - "Orchestrator pattern: saveEntry uploads attachments first, then markdown note"
  - "State machine: 6 states with callback_query routing by prefix"
  - "Photo pipeline: download immediately on message, store in Map, upload on save"

requirements-completed: [PHOT-01, PHOT-02, PHOT-03, DEDU-01, DEDU-02]

duration: 12min
completed: 2026-03-28
---

# Phase 2 Plan 3: Storage Orchestrator + Bot Rewrite Summary

**WebDAV save pipeline with 6-state bot, immediate photo download, two-level navigation, tag selection, and filename-based dedup**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-28T06:40:00Z
- **Completed:** 2026-03-28T06:52:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Storage orchestrator that uploads photos to vault/attachments/ then generates and uploads markdown notes
- Full bot.ts rewrite: 6-state machine replacing old Notion-based flow with WebDAV pipeline
- Immediate photo download on message receipt (module-level Map, not session storage)
- Two-level navigation: category -> subcategory -> tags -> title -> save
- Inbox quick-save: one tap, auto-title, no tags
- Duplicate detection via filename existence check with save-new/cancel keyboard

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/services/storage.ts** - `89e28fe` (feat)
2. **Task 2: Rewrite src/bot.ts** - `4ae8f5f` (feat)
3. **Task 3: Verify full content pipeline end-to-end** - checkpoint approved, no commit needed

## Files Created/Modified
- `src/services/storage.ts` - SaveEntry orchestrator (photo upload + markdown generation + WebDAV save) and findDuplicate (PROPFIND existence check)
- `src/bot.ts` - Complete rewrite: 6-state machine, photo download, two-level navigation callbacks, tag selection, dedup UI, Inbox quick-save

## Decisions Made
- Photos stored in module-level Map keyed by chat.id (not grammY session) to avoid serialization issues with binary data
- Dedup check happens after title input when filename is known, not on content receipt
- Inbox quick-save bypasses both tags and title, using autoTitle for filename

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None - all data paths are fully wired.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All content pipeline components wired and tested end-to-end
- Ready for Phase 3: remove Notion imports, clean up old files (hashtags.ts, notion.ts), update config, deploy to VPS
- Old notion.ts and hashtags.ts files preserved intentionally for Phase 3 cleanup

## Self-Check: PASSED

- FOUND: src/services/storage.ts
- FOUND: src/bot.ts
- FOUND: 02-03-SUMMARY.md
- FOUND: commit 89e28fe
- FOUND: commit 4ae8f5f

---
*Phase: 02-content-pipeline*
*Completed: 2026-03-28*
