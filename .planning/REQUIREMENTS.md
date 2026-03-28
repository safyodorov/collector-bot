# Requirements: Collector Bot WebDAV Migration

**Defined:** 2026-03-28
**Core Value:** Контент из Telegram попадает в Obsidian vault быстро, с категориями, и доступен на всех устройствах через Яндекс.Диск.

## v1 Requirements

### WebDAV Client

- [ ] **WDAV-01**: Бот подключается к Яндекс.Диску через WebDAV с OAuth-токеном
- [ ] **WDAV-02**: Бот создаёт директории на WebDAV (MKCOL) с кэшированием созданных
- [ ] **WDAV-03**: Бот загружает текстовые файлы на WebDAV (PUT) с корректной кодировкой кириллицы
- [ ] **WDAV-04**: Бот загружает бинарные файлы (фото) на WebDAV (PUT)
- [ ] **WDAV-05**: Бот проверяет существование файла на WebDAV (PROPFIND)
- [ ] **WDAV-06**: Бот повторяет неудачные запросы с экспоненциальным backoff (429, 5xx)

### Markdown Generation

- [ ] **MKDN-01**: Бот генерирует Obsidian-совместимый Markdown с YAML frontmatter (tags, source, date, type, content_hash)
- [ ] **MKDN-02**: Frontmatter использует формат tags (список без #), совместимый с Obsidian 1.9+
- [ ] **MKDN-03**: Тело заметки содержит текст контента, ссылки на фото и видео
- [ ] **MKDN-04**: Имя файла генерируется из даты и заголовка: `2026-03-28_Шарлотка.md`
- [ ] **MKDN-05**: Имена файлов санитизируются (запрещённые символы, лимит ~120 символов/240 байт)

### Photo Pipeline

- [ ] **PHOT-01**: Фото скачивается с Telegram API сразу при получении сообщения (до истечения URL)
- [ ] **PHOT-02**: Фото загружается на WebDAV в vault/attachments/ с уникальным именем
- [ ] **PHOT-03**: В заметке фото вставляется как `![](attachments/filename.jpg)`

### Folder Structure

- [ ] **FOLD-01**: Vault содержит папки: Рецепты/, Работа/, Идеи/, Разное/, attachments/
- [ ] **FOLD-02**: Хэштеги маппятся на папки: рецепт/еда/готовка → Рецепты, работа/wb/wildberries → Работа, идея/проект → Идеи, остальное → Разное
- [ ] **FOLD-03**: Папки создаются автоматически при первом использовании (MKCOL)

### Deduplication

- [ ] **DEDU-01**: Дубликаты определяются по существованию файла с тем же именем (PROPFIND)
- [ ] **DEDU-02**: При обнаружении дубликата пользователь видит inline-клавиатуру с выбором: сохранить как новый или отменить

### Config & Cleanup

- [ ] **CONF-01**: Переменные окружения обновлены: добавлены YANDEX_WEBDAV_LOGIN, YANDEX_WEBDAV_PASSWORD (или YANDEX_DISK_TOKEN), VAULT_PATH
- [ ] **CONF-02**: Переменные NOTION_TOKEN и NOTION_DATABASE_ID удалены из config.ts
- [ ] **CONF-03**: Зависимость @notionhq/client удалена из package.json
- [ ] **CONF-04**: UI-тексты бота не упоминают Notion (переименование saveToNotion → saveEntry и т.д.)
- [ ] **CONF-05**: Бот стартует и работает через PM2 на VPS без ошибок

## v2 Requirements

### Stability Improvements

- **STAB-01**: PM2 config с restart limits (max_restarts, min_uptime, restart_delay)
- **STAB-02**: Обработка ошибок в findDuplicate с try/catch
- **STAB-03**: Логирование WebDAV запросов с кодами ответов

### Code Quality

- **QUAL-01**: Извлечение forward-origin парсинга в отдельную функцию (убрать дублирование)
- **QUAL-02**: Извлечение хэндлеров из bot.ts в src/handlers/
- **QUAL-03**: Unit-тесты для утилит (text-utils, content-hash, markdown generator)

### Nice-to-Have

- **NICE-01**: Сжатие фото через sharp перед загрузкой на WebDAV
- **NICE-02**: Миграция существующих заметок из Notion в vault
- **NICE-03**: Восстановление индекса дедупликации из frontmatter заметок

## Out of Scope

| Feature | Reason |
|---------|--------|
| Настройка Remotely Save в Obsidian | Ручная настройка на каждом устройстве |
| Двусторонняя синхронизация (редактирование в Obsidian → бот) | Бот только пишет, не читает |
| Скачивание видео через yt-dlp | Не меняется, работает как раньше |
| Рефакторинг state machine | Работает, не ломаем |
| OAuth token renewal UI | Ручной процесс раз в 12 месяцев |
| Поддержка нескольких пользователей | Бот для одного пользователя |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| WDAV-01 | Phase 1 | Pending |
| WDAV-02 | Phase 1 | Pending |
| WDAV-03 | Phase 1 | Pending |
| WDAV-04 | Phase 1 | Pending |
| WDAV-05 | Phase 1 | Pending |
| WDAV-06 | Phase 1 | Pending |
| MKDN-01 | Phase 2 | Pending |
| MKDN-02 | Phase 2 | Pending |
| MKDN-03 | Phase 2 | Pending |
| MKDN-04 | Phase 2 | Pending |
| MKDN-05 | Phase 2 | Pending |
| PHOT-01 | Phase 2 | Pending |
| PHOT-02 | Phase 2 | Pending |
| PHOT-03 | Phase 2 | Pending |
| FOLD-01 | Phase 1 | Pending |
| FOLD-02 | Phase 2 | Pending |
| FOLD-03 | Phase 1 | Pending |
| DEDU-01 | Phase 2 | Pending |
| DEDU-02 | Phase 2 | Pending |
| CONF-01 | Phase 3 | Pending |
| CONF-02 | Phase 3 | Pending |
| CONF-03 | Phase 3 | Pending |
| CONF-04 | Phase 3 | Pending |
| CONF-05 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after initial definition*
