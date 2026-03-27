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
export const NOTION_TOKEN = required('NOTION_TOKEN')
export const NOTION_DATABASE_ID = required('NOTION_DATABASE_ID')
export const YANDEX_DISK_TOKEN = process.env.YANDEX_DISK_TOKEN || ''

export const DEFAULT_HASHTAGS = (process.env.DEFAULT_HASHTAGS || 'завтраки,супы,выпечка,мясо,салаты,десерты,напитки,соусы,заготовки,другое').split(',')
export const MAX_VIDEO_SIZE_MB = parseInt(process.env.MAX_VIDEO_SIZE_MB || '500', 10)
export const VIDEO_QUALITY = process.env.VIDEO_QUALITY || '1080'

// Owner chat_id — only this user can use the bot
export const OWNER_CHAT_ID = 81006248
