# Roadmap: Collector Bot WebDAV Migration

## Overview

Replace Notion API storage with Yandex.Disk WebDAV in three phases: build the WebDAV transport layer, wire up the full content pipeline (markdown, photos, two-level navigation, tags, dedup), then cut over by removing Notion and deploying. The bot gets a new two-level folder navigation UI replacing the old hashtag multi-select.

## Phases

- [x] **Phase 1: WebDAV Foundation** - HTTP transport layer and vault directory structure on Yandex.Disk (completed 2026-03-28)
- [ ] **Phase 2: Content Pipeline** - Markdown generation, photo handling, two-level navigation, tags, folder routing, and deduplication
- [ ] **Phase 3: Cutover & Deploy** - Remove Notion, update config, rename UI texts, deploy to VPS

## Phase Details

### Phase 1: WebDAV Foundation
**Goal**: Bot can create directories and upload/check files on Yandex.Disk via WebDAV
**Depends on**: Nothing (first phase)
**Requirements**: WDAV-01, WDAV-02, WDAV-03, WDAV-04, WDAV-05, WDAV-06, FOLD-01, FOLD-02
**Success Criteria** (what must be TRUE):
  1. Bot authenticates with Yandex.Disk and receives a successful response
  2. Bot creates the full vault folder structure (27 папок + attachments/) on Yandex.Disk
  3. Bot uploads a text file with Cyrillic name to Yandex.Disk and the file is readable via WebDAV
  4. Bot uploads a binary file (photo) to Yandex.Disk attachments/ and the file is intact
  5. Bot retries a failed request and succeeds on subsequent attempt
**Plans:** 2/2 plans complete
Plans:
- [x] 01-01-PLAN.md -- WebDAV client module + config exports (WDAV-01 through WDAV-06)
- [x] 01-02-PLAN.md -- Vault folder structure + integration test (FOLD-01, FOLD-02)

### Phase 2: Content Pipeline
**Goal**: Bot saves incoming Telegram content as Obsidian-compatible notes with photos, correct folders, and dedup
**Depends on**: Phase 1
**Requirements**: MKDN-01, MKDN-02, MKDN-03, MKDN-04, MKDN-05, PHOT-01, PHOT-02, PHOT-03, FOLD-03, NAVG-01, NAVG-02, NAVG-03, NAVG-04, TAGS-01, TAGS-02, TAGS-03, TAGS-04, DEDU-01, DEDU-02
**Success Criteria** (what must be TRUE):
  1. Sending a text message to the bot produces a .md file on Yandex.Disk with correct YAML frontmatter and body
  2. Sending a photo to the bot produces an attachment in vault/attachments/ and a note linking to it
  3. Two-level navigation works: выбор "Бизнес" → показывает подкатегории (WB, Ozon, ...) → заметка в правильной папке
  4. Кнопка Inbox сохраняет заметку сразу в vault/Inbox/ без подкатегорий
  5. Теги предлагаются после выбора папки и записываются в frontmatter
  6. Sending the same content twice triggers the duplicate detection UI with options to save or cancel
  7. Generated filenames are sanitized and contain date + title (e.g. 2026-03-28_Шарлотка.md)
**Plans:** 3 plans in 2 waves
Plans:
- [x] 02-01-PLAN.md -- Pure functions: markdown generator, filename sanitizer, category/tag config
- [x] 02-02-PLAN.md -- Two-level navigation keyboards (category, subcategory, tags)
- [x] 02-03-PLAN.md -- Storage orchestrator + bot.ts rewrite (state machine, photo pipeline, dedup)

### Phase 3: Cutover & Deploy
**Goal**: Bot runs on VPS with WebDAV only, no Notion traces remain
**Depends on**: Phase 2
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05
**Success Criteria** (what must be TRUE):
  1. .env contains YANDEX_WEBDAV_LOGIN/PASSWORD (or YANDEX_DISK_TOKEN) and VAULT_PATH, no NOTION_* variables
  2. @notionhq/client is absent from package.json and node_modules
  3. Bot UI texts do not mention "Notion" anywhere
  4. Bot starts via PM2 on VPS and processes a test message end-to-end without errors
**Plans:** 2 plans in 2 waves
Plans:
- [x] 03-01-PLAN.md -- Remove Notion dead code, config vars, and @notionhq/client dependency (CONF-01, CONF-02, CONF-03, CONF-04)
- [ ] 03-02-PLAN.md -- Deploy to VPS, verify PM2 startup and end-to-end test (CONF-05)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. WebDAV Foundation | 2/2 | Complete   | 2026-03-28 |
| 2. Content Pipeline | 3/3 | Complete | 2026-03-28 |
| 3. Cutover & Deploy | 1/2 | In progress | - |
