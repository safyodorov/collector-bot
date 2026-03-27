# Collector Bot

Telegram-бот для сбора контента в Notion. Принимает текст, фото, видео-ссылки и пересланные сообщения, категоризирует через inline-клавиатуру и сохраняет в структурированную базу Notion.

## Возможности

- **Автоопределение типа контента** (текст, фото, видео-ссылка, пересланное сообщение)
- **Категоризация** через inline-клавиатуру с предустановленными хэштегами
- **Сохранение в Notion** с заполнением всех полей
- **Дедупликация** по SHA-256 хешу контента
- **Скачивание видео** через yt-dlp + загрузка на Яндекс.Диск (опционально)
- **Атрибуция источника** (канал, автор, дата оригинала при пересылке)

## Структура Notion DB

| Свойство | Тип | Описание |
|----------|-----|----------|
| Name | Title | Название записи |
| Category | Multi-select | Хэштеги/категории |
| Content Type | Select | текст / фото / видео / пересланное |
| Source | Rich text | Источник контента |
| Date Added | Date | Дата добавления |
| Original URL | URL | Оригинальная ссылка |
| Video YaDisk | URL | Ссылка на видео на Яндекс.Диске |
| Content Hash | Rich text | SHA-256 хеш для дедупликации |

## Установка

```bash
npm install
cp .env.example .env
# Заполнить .env токенами

# Создать базу данных в Notion:
node scripts/create-notion-db.mjs <parent_page_id>

# Запуск
npm run build
npm start
```

## Деплой (PM2)

```bash
npm run build
pm2 start ecosystem.config.cjs
```

## Технический стек

- **Runtime**: Node.js 22
- **Язык**: TypeScript
- **Telegram**: grammy
- **Notion**: @notionhq/client
- **Видео**: yt-dlp (CLI)
- **Хранение видео**: Яндекс.Диск REST API
- **Process manager**: PM2
