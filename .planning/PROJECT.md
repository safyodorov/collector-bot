# Collector Bot: Notion → Obsidian Migration

## What This Is

Telegram-бот для сбора контента (текст, фото, видео-ссылки, пересланные сообщения) с категоризацией через inline-кнопки. Сейчас сохраняет в Notion, мигрирует на Obsidian vault на Яндекс.Диске через WebDAV. Единственный пользователь — владелец бота (Сергей Фёдоров).

## Core Value

Контент из Telegram попадает в Obsidian vault быстро, с категориями, и доступен на всех устройствах через Яндекс.Диск.

## Requirements

### Validated

- ✓ Приём текста, фото, видео-ссылок, пересланных сообщений — existing
- ✓ Категоризация через inline-клавиатуру с хэштегами — existing
- ✓ Дедупликация по SHA-256 хешу контента — existing
- ✓ Определение типа контента (текст/фото/видео/пересланное) — existing
- ✓ Автоматическое определение источника пересланных сообщений — existing
- ✓ Генерация заголовка из первой строки или ввод вручную — existing
- ✓ Детекция видео-ссылок (YouTube, VK, RuTube, Dzen, OK) — existing

### Active

- [ ] Замена Notion API на WebDAV Яндекс.Диска для хранения заметок
- [ ] Генерация Obsidian-совместимого Markdown с YAML frontmatter
- [ ] Загрузка фото на Яндекс.Диск (vault/attachments/) вместо Notion
- [ ] Структура папок: Рецепты/, Работа/, Идеи/, Разное/, attachments/
- [ ] Маппинг хэштегов на папки (рецепт/еда/готовка → Рецепты и т.д.)
- [ ] Дедупликация по имени файла (дата + заголовок) вместо Notion API query
- [ ] Обновление переменных окружения (YANDEX_WEBDAV_LOGIN/PASSWORD, убрать NOTION_*)
- [ ] Удаление @notionhq/client, переход на нативный fetch для WebDAV
- [ ] Переименование UI-текстов (убрать упоминания Notion)

### Out of Scope

- Миграция существующих заметок из Notion в Obsidian — ручной процесс, не задача бота
- Настройка Remotely Save плагина в Obsidian — делается вручную на устройствах
- Скачивание видео через yt-dlp — не меняется, работает как раньше
- Загрузка видео на Яндекс.Диск — существующая фича, вне скоупа миграции
- Рефакторинг bot.ts на отдельные хэндлеры — можно, но не блокер для миграции
- Добавление тестов — желательно, но отдельная задача

## Context

**Причина миграции:** Notion заблокировал мобильный доступ из России ("prohibited jurisdiction"). VPN не помогает на Android. Мобильный доступ к заметкам критичен.

**Решение:** Obsidian vault на Яндекс.Диске. Синхронизация через плагин Remotely Save (WebDAV). Obsidian работает офлайн, данные на российском облаке.

**Текущий стек:** TypeScript, grammy, @notionhq/client, Node.js 22, PM2. Деплой на VPS 212.74.231.132.

**Проблемы стабильности:** 12 рестартов за 8 часов на PM2. Нет retry-логики, нет обработки ошибок в findDuplicate, сессии теряются при рестарте.

**Качество кода:** Вся логика в bot.ts (344 строки), 6 `any` кастов, пустая директория handlers/, 0 тестов. Forward-origin парсинг дублируется 3 раза. Фото сохраняются как временные Telegram URL (истекают через час).

**WebDAV Яндекс.Диска:**
- Endpoint: https://webdav.yandex.ru
- Auth: `Authorization: OAuth <token>` или `Basic <base64(login:app_password)>`
- Операции: PUT (файлы), MKCOL (папки), PROPFIND (проверка существования)

## Constraints

- **Tech stack**: TypeScript, grammy, Node.js 22 — не меняется
- **Storage**: WebDAV Яндекс.Диска — единственный вариант хранилища
- **Format**: Obsidian-совместимый Markdown с YAML frontmatter
- **Compatibility**: Существующий UX бота не должен измениться для пользователя
- **Single user**: Бот для одного пользователя, конкурентность не проблема
- **No new deps**: WebDAV через нативный fetch, без дополнительных npm-пакетов
- **Cyrillic**: Имена файлов и папок на русском, нужна санитизация

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WebDAV через нативный fetch вместо npm webdav | PDF указывает: "ничего, WebDAV работает через обычный fetch". Меньше зависимостей. | — Pending |
| Дедупликация по имени файла (дата+заголовок) | Проще чем индексный файл. Формат: 2026-03-28_Шарлотка.md. PROPFIND проверяет существование. | — Pending |
| Фото в vault/attachments/ через WebDAV PUT | Telegram URL истекают. Нужно скачивать и перезаливать. Obsidian покажет inline. | — Pending |
| Видео вне vault | Чтобы не раздувать синхронизацию Obsidian. Ссылка в frontmatter. | — Pending |
| Маппинг хэштегов → папки | рецепт/еда/готовка → Рецепты/, работа/wb → Работа/, идея/проект → Идеи/, остальное → Разное/ | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after initialization*
