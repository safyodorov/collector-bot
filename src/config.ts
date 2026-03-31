import { config } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })

export const PROJECT_ROOT = resolve(__dirname, '..')

function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env: ${name}`)
  return val
}

export const BOT_TOKEN = required('TELEGRAM_BOT_TOKEN')
export const YANDEX_DISK_TOKEN = required('YANDEX_DISK_TOKEN')
export const VAULT_PATH = process.env.VAULT_PATH || '/vault'

export const MAX_VIDEO_SIZE_MB = parseInt(process.env.MAX_VIDEO_SIZE_MB || '500', 10)
export const VIDEO_QUALITY = process.env.VIDEO_QUALITY || '1080'

// Owner chat_id — only this user can use the bot
export const OWNER_CHAT_ID = 81006248

// Content types
export type ContentType = 'текст' | 'фото' | 'видео' | 'пересланное' | 'документ'

// Category definitions for vault folder mapping
export interface CategoryDef {
  label: string
  path: string
  subs?: Record<string, { label: string; path: string }>
}

export const CATEGORY_MAP: Record<string, CategoryDef> = {
  бизнес: {
    label: 'Бизнес',
    path: '/Бизнес/',
    subs: {
      wb: { label: 'WB', path: '/Бизнес/WB/' },
      ozon: { label: 'Ozon', path: '/Бизнес/Ozon/' },
      закупки: { label: 'Закупки', path: '/Бизнес/Закупки/' },
      финансы: { label: 'Финансы', path: '/Бизнес/Финансы/' },
      аналитика: { label: 'Аналитика', path: '/Бизнес/Аналитика/' },
      контент: { label: 'Контент', path: '/Бизнес/Контент/' },
      налоги: { label: 'Налоги', path: '/Бизнес/Налоги/' },
      сотрудники: { label: 'Сотрудники', path: '/Бизнес/Сотрудники/' },
    },
  },
  ландшафт: {
    label: 'Ландшафт',
    path: '/Ландшафт/',
    subs: {
      растения: { label: 'Растения', path: '/Ландшафт/Растения/' },
      проекты: { label: 'Проекты', path: '/Ландшафт/Проекты/' },
      благоустройство: { label: 'Благоустройство', path: '/Ландшафт/Благоустройство/' },
    },
  },
  тос: {
    label: 'ТОС',
    path: '/ТОС/',
    subs: {
      документы: { label: 'Документы', path: '/ТОС/Документы/' },
      протоколы: { label: 'Протоколы', path: '/ТОС/Протоколы/' },
      инициативы: { label: 'Инициативы', path: '/ТОС/Инициативы/' },
      ук: { label: 'УК', path: '/ТОС/УК/' },
    },
  },
  рецепты: {
    label: 'Рецепты',
    path: '/Рецепты/',
    subs: {
      супы: { label: 'Супы', path: '/Рецепты/Супы/' },
      мясо: { label: 'Мясо', path: '/Рецепты/Мясо/' },
      выпечка: { label: 'Выпечка', path: '/Рецепты/Выпечка/' },
      напитки: { label: 'Напитки', path: '/Рецепты/Напитки/' },
    },
  },
  семья: {
    label: 'Семья',
    path: '/Семья/',
    subs: {
      дети: { label: 'Дети', path: '/Семья/Дети/' },
      дом: { label: 'Дом', path: '/Семья/Дом/' },
    },
  },
  кодинг: {
    label: 'Кодинг',
    path: '/Кодинг/',
    subs: {
      frontend: { label: 'Frontend', path: '/Кодинг/Frontend/' },
      backend: { label: 'Backend', path: '/Кодинг/Backend/' },
      devops: { label: 'DevOps', path: '/Кодинг/DevOps/' },
      инструменты: { label: 'Инструменты', path: '/Кодинг/Инструменты/' },
      проекты: { label: 'Проекты', path: '/Кодинг/Проекты/' },
    },
  },
  нейросети: {
    label: 'Нейросети',
    path: '/Нейросети/',
    subs: {
      промпты: { label: 'Промпты', path: '/Нейросети/Промпты/' },
      инструменты: { label: 'Инструменты', path: '/Нейросети/Инструменты/' },
      кейсы: { label: 'Кейсы', path: '/Нейросети/Кейсы/' },
    },
  },
  кино: {
    label: 'Кино',
    path: '/Кино/',
    subs: {
      посмотреть: { label: 'Посмотреть', path: '/Кино/Посмотреть/' },
    },
  },
  лайфхаки: { label: 'Лайфхаки', path: '/Лайфхаки/' },
  здоровье: {
    label: 'Здоровье',
    path: '/Здоровье/',
    subs: {
      моё: { label: 'Моё здоровье', path: '/Здоровье/Моё здоровье/' },
    },
  },
  новости: { label: 'Новости', path: '/Новости/' },
  идеи: { label: 'Идеи', path: '/Идеи/' },
  inbox: { label: 'Inbox', path: '/Inbox/' },
}

// Media pipeline
export const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? ''
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://litellm.tokengate.ru/v1'
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? 'openai/gpt-5.2'
export const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS) || 18000

// Obsidian / Yandex.Disk
export const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? '/Obsidian/Media'
export const YANDEX_WEBDAV_LOGIN = process.env.YANDEX_WEBDAV_LOGIN ?? ''
export const YANDEX_WEBDAV_PASSWORD = process.env.YANDEX_WEBDAV_PASSWORD ?? ''

// Temp directory for media pipeline
export const TEMP_DIR = resolve(PROJECT_ROOT, 'tmp')
mkdirSync(TEMP_DIR, { recursive: true })

export const CATEGORY_TAGS: Record<string, string[]> = {
  бизнес: ['аналитика', 'задача', 'идея', 'важное', 'финансы', 'поставщики', 'китай', 'логистика'],
  ландшафт: ['растения', 'проект', 'покупка', 'сезонное'],
  тос: ['протокол', 'решение', 'жалоба', 'проект'],
  рецепты: ['быстрый', 'сложный', 'десерт', 'здоровое'],
  семья: ['школа', 'здоровье', 'покупка', 'событие'],
  кино: ['фильм', 'сериал', 'мультфильм', 'документальное'],
  'кино/посмотреть': ['ужасы', 'драма', 'триллер', 'комедия', 'фэнтези', 'документальное', 'фильм', 'сериал', 'мультфильм'],
  кодинг: ['typescript', 'python', 'tutorial', 'баг', 'архитектура'],
  нейросети: ['chatgpt', 'claude', 'midjourney', 'автоматизация', 'промпт'],
  лайфхаки: ['дом', 'кухня', 'экономия', 'полезное'],
  здоровье: ['питание', 'спорт', 'сон', 'анализы', 'лечение'],
  новости: ['политика', 'экономика', 'технологии', 'местное'],
  идеи: ['проект', 'бизнес', 'дом', 'хобби'],
}
