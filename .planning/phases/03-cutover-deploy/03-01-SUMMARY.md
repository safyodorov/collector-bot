---
phase: 03-cutover-deploy
plan: 01
subsystem: config
tags: [cleanup, notion-removal, dependencies]
dependency_graph:
  requires: []
  provides: [clean-config, notion-free-codebase]
  affects: [src/config.ts, package.json]
tech_stack:
  removed: ["@notionhq/client"]
  patterns: [dead-code-removal]
key_files:
  modified: [src/config.ts, package.json, package-lock.json, .env]
  deleted: [src/services/notion.ts, src/keyboards/hashtags.ts]
decisions:
  - ".env changes not tracked (gitignored) -- VPS has its own .env"
metrics:
  duration: 2min
  completed: 2026-03-28
---

# Phase 03 Plan 01: Remove Notion Dead Code Summary

Removed all Notion traces: deleted 2 dead code files, stripped 3 config vars, uninstalled @notionhq/client (22 packages), cleaned .env of NOTION_* entries. Build passes cleanly with WebDAV-only storage.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Remove Notion dead code and config vars | a10d869 | Deleted notion.ts, hashtags.ts; removed NOTION_TOKEN, NOTION_DATABASE_ID, DEFAULT_HASHTAGS from config.ts; cleaned .env |
| 2 | Remove @notionhq/client and verify build | 489cbef | npm uninstall @notionhq/client; updated package.json description; verified build and zero grep matches |

## Verification Results

- `npm run build` -- succeeds (exit 0)
- `grep -ri notion src/` -- 0 matches
- `grep -q notionhq package.json` -- not found (exit 1)
- `test -f src/services/notion.ts` -- not found (exit 1)
- `test -f src/keyboards/hashtags.ts` -- not found (exit 1)

## Deviations from Plan

None -- plan executed exactly as written. One minor note: .env is gitignored so its changes are not tracked in commits. The cleanup was done locally; VPS .env will be handled in 03-02 (deploy plan).

## Known Stubs

None.
