import { ensureDir } from './webdav.js'
import { VAULT_PATH } from '../config.js'

export const VAULT_FOLDERS = [
  '',                           // vault root
  '/Бизнес',
  '/Бизнес/WB',
  '/Бизнес/Ozon',
  '/Бизнес/Закупки',
  '/Бизнес/Финансы',
  '/Бизнес/Аналитика',
  '/Бизнес/Контент',
  '/Бизнес/Налоги',
  '/Ландшафт',
  '/Ландшафт/Растения',
  '/Ландшафт/Проекты',
  '/Ландшафт/Благоустройство',
  '/ТОС',
  '/ТОС/Документы',
  '/ТОС/Протоколы',
  '/ТОС/Инициативы',
  '/Семья',
  '/Семья/Дети',
  '/Семья/Дом',
  '/Рецепты',
  '/Рецепты/Супы',
  '/Рецепты/Мясо',
  '/Рецепты/Выпечка',
  '/Рецепты/Напитки',
  '/Новости',
  '/Идеи',
  '/Inbox',
  '/attachments',
]

export async function initVault(): Promise<void> {
  for (const folder of VAULT_FOLDERS) {
    await ensureDir(`${VAULT_PATH}${folder}`)
  }
  console.log(`[VAULT] Structure verified: ${VAULT_FOLDERS.length} folders`)
}
