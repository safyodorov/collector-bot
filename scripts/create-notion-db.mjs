#!/usr/bin/env node
// Creates the Notion database for Collector bot
// Usage: node scripts/create-notion-db.mjs <parent_page_id>
// The parent_page_id is the ID of an existing Notion page where the DB will be created

import { Client } from '@notionhq/client'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')

function readEnv() {
  try {
    const content = readFileSync(envPath, 'utf-8')
    const env = {}
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/)
      if (match) env[match[1].trim()] = match[2].trim()
    }
    return env
  } catch { return {} }
}

const env = readEnv()
const NOTION_TOKEN = env.NOTION_TOKEN || process.env.NOTION_TOKEN
if (!NOTION_TOKEN) { console.error('NOTION_TOKEN not found'); process.exit(1) }

const parentPageId = process.argv[2]
if (!parentPageId) {
  console.error('Usage: node scripts/create-notion-db.mjs <parent_page_id>')
  console.error('')
  console.error('To find parent_page_id:')
  console.error('1. Open any page in Notion where you want the database')
  console.error('2. Copy the page URL: https://www.notion.so/Your-Page-abc123def456')
  console.error('3. The ID is the 32-char hex string: abc123def456...')
  console.error('')
  console.error('IMPORTANT: Make sure your integration is connected to that page!')
  console.error('Page → ... → Connections → Add connection → select "Collector"')
  process.exit(1)
}

const notion = new Client({ auth: NOTION_TOKEN })

const DEFAULT_HASHTAGS = ['завтраки', 'супы', 'выпечка', 'мясо', 'салаты', 'десерты', 'напитки', 'соусы', 'заготовки', 'другое']

async function main() {
  console.log('Creating Notion database...')

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Коллекция' } }],
    icon: { type: 'emoji', emoji: '📦' },
    properties: {
      'Name': { title: {} },
      'Category': {
        multi_select: {
          options: DEFAULT_HASHTAGS.map(name => ({ name }))
        }
      },
      'Content Type': {
        select: {
          options: [
            { name: 'текст', color: 'blue' },
            { name: 'фото', color: 'green' },
            { name: 'видео', color: 'red' },
            { name: 'пересланное', color: 'yellow' },
          ]
        }
      },
      'Source': { rich_text: {} },
      'Date Added': { date: {} },
      'Original URL': { url: {} },
      'Video YaDisk': { url: {} },
      'Content Hash': { rich_text: {} },
    }
  })

  console.log('Database created!')
  console.log('  ID:', db.id)
  console.log('  URL:', db.url)

  // Update .env with database ID
  const envContent = readFileSync(envPath, 'utf-8')
  const updated = envContent.replace(/^NOTION_DATABASE_ID=.*$/m, `NOTION_DATABASE_ID=${db.id}`)
  writeFileSync(envPath, updated)
  console.log('\n.env updated with NOTION_DATABASE_ID=%s', db.id)
}

main().catch(err => {
  console.error('Error:', err.message)
  if (err.code === 'object_not_found') {
    console.error('\nThe parent page was not found. Make sure:')
    console.error('1. The page ID is correct')
    console.error('2. The integration "Collector" is connected to that page')
    console.error('   (Page → ... → Connections → Add connection)')
  }
  process.exit(1)
})
