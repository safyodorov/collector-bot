import { config } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })

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
      поставщики: { label: 'Поставщики', path: '/Бизнес/Поставщики/' },
      финансы: { label: 'Финансы', path: '/Бизнес/Финансы/' },
      аналитика: { label: 'Аналитика', path: '/Бизнес/Аналитика/' },
      контент: { label: 'Контент', path: '/Бизнес/Контент/' },
      налоги: { label: 'Налоги', path: '/Бизнес/Налоги/' },
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
  новости: { label: 'Новости', path: '/Новости/' },
  идеи: { label: 'Идеи', path: '/Идеи/' },
  inbox: { label: 'Inbox', path: '/Inbox/' },
}

export const CATEGORY_TAGS: Record<string, string[]> = {
  бизнес: ['аналитика', 'задача', 'идея', 'важное', 'финансы'],
  ландшафт: ['растения', 'проект', 'покупка', 'сезонное'],
  тос: ['протокол', 'решение', 'жалоба', 'проект'],
  рецепты: ['быстрый', 'сложный', 'десерт', 'здоровое'],
  семья: ['школа', 'здоровье', 'покупка', 'событие'],
  кодинг: ['typescript', 'python', 'tutorial', 'баг', 'архитектура'],
  нейросети: ['chatgpt', 'claude', 'midjourney', 'автоматизация', 'промпт'],
  новости: ['политика', 'экономика', 'технологии', 'местное'],
  идеи: ['проект', 'бизнес', 'дом', 'хобби'],
}
