---
phase: 04-media-pipeline
plan: 03
status: completed
started: "2026-03-29T08:36:00Z"
completed: "2026-03-30T21:53:00Z"
tasks_completed: 3
tasks_total: 3
deviations:
  - description: "Расширен далеко за рамки плана — добавлены локальные видеофайлы, мультивидео, Pyrogram MTProto fallback"
    impact: positive
key_files:
  created:
    - src/services/media-pipeline.ts
  modified:
    - src/bot.ts
    - src/services/downloader.ts
    - src/services/transcriber.ts
    - src/services/summarizer.ts
    - src/services/webdav.ts
---

# Plan 04-03: Pipeline Orchestrator + Bot Integration — SUMMARY

## What was built

Pipeline orchestrator (`media-pipeline.ts`) и полная интеграция в бот:

1. **Pipeline orchestrator** — оркестрирует цепочку: скачать → транскрибировать → саммаризировать. Лимит конкурентности (2), прогресс-коллбэки, очистка temp-файлов в finally.

2. **URL detection + inline keyboard** — бот определяет YouTube/VK/Rutube ссылки, показывает инфо о видео и предлагает выбор: сохранить видео целиком / только саммари / пропустить.

3. **Локальные видеофайлы** — обработка видео, отправленных как файлы в Telegram (до 2GB через Pyrogram MTProto fallback для >20MB).

4. **Мультивидео** — группы видео буферизуются и транскрибируются по отдельности, результаты объединяются в одну заметку.

5. **3-уровневые опции** — fullvid (видео + транскрипт + саммари), full (транскрипт + саммари), summary (только саммари).

6. **Obsidian integration** — заметки и транскрипты сохраняются в правильные папки vault с категориями и тегами через WebDAV/REST API.

## Decisions

- Заменён Deepgram SDK на прямой REST API (проблемы совместимости SDK v5)
- Pyrogram MTProto fallback для видео >20MB (лимит Telegram Bot API)
- REST API Яндекс.Диска вместо WebDAV для загрузки
- Транскрипт рядом с заметкой в той же папке vault

## Self-Check: PASSED

- [x] media-pipeline.ts создан с processMediaUrl и processVideoFile
- [x] bot.ts интегрирован — URL detection, inline keyboard, callback handlers
- [x] Конкурентность ограничена (MAX_CONCURRENT_PIPELINES = 2)
- [x] Temp-файлы чистятся в finally
- [x] npm run build проходит
- [x] Деплой на VPS работает, бот обрабатывает видео end-to-end
