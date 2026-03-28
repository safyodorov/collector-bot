import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      TELEGRAM_BOT_TOKEN: 'test',
      NOTION_TOKEN: 'test',
      NOTION_DATABASE_ID: 'test',
      YANDEX_DISK_TOKEN: 'test',
    },
  },
})
