import { Client } from '@notionhq/client'
import { NOTION_TOKEN, NOTION_DATABASE_ID } from '../config.js'
import { splitText } from '../utils/text-utils.js'
import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints.js'

const notion = new Client({ auth: NOTION_TOKEN })

export type ContentType = 'текст' | 'фото' | 'видео' | 'пересланное'

export interface PageData {
  title: string
  categories: string[]
  contentType: ContentType
  source?: string
  text?: string
  imageUrls?: string[]
  originalUrl?: string
  videoYaDiskUrl?: string
  contentHash?: string
}

/** Check if content with this hash already exists */
export async function findDuplicate(hash: string): Promise<{ id: string; title: string; date: string } | null> {
  const res = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Content Hash',
      rich_text: { equals: hash }
    }
  })
  if (res.results.length === 0) return null
  const page = res.results[0] as any
  const props = page.properties
  return {
    id: page.id,
    title: props.Name?.title?.[0]?.plain_text || 'Без названия',
    date: props['Date Added']?.date?.start || page.created_time?.slice(0, 10) || '',
  }
}

/** Create a page in the Notion database */
export async function createPage(data: PageData): Promise<{ id: string; url: string }> {
  // Build page body blocks
  const children: BlockObjectRequest[] = []

  // Text content as paragraphs
  if (data.text) {
    const chunks = splitText(data.text, 2000)
    for (const chunk of chunks) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }]
        }
      })
    }
  }

  // Images as external image blocks
  if (data.imageUrls) {
    for (const url of data.imageUrls) {
      children.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url }
        }
      })
    }
  }

  // Video link as bookmark
  if (data.originalUrl) {
    children.push({
      object: 'block',
      type: 'bookmark',
      bookmark: { url: data.originalUrl }
    })
  }

  // Source info
  if (data.source) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: `Источник: ${data.source}` }, annotations: { italic: true, color: 'gray' } }]
      }
    })
  }

  // Build properties
  const properties: Record<string, any> = {
    'Name': { title: [{ text: { content: data.title } }] },
    'Category': { multi_select: data.categories.map(name => ({ name })) },
    'Content Type': { select: { name: data.contentType } },
    'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } },
  }

  if (data.source) {
    properties['Source'] = { rich_text: [{ text: { content: data.source.slice(0, 2000) } }] }
  }
  if (data.originalUrl) {
    properties['Original URL'] = { url: data.originalUrl }
  }
  if (data.videoYaDiskUrl) {
    properties['Video YaDisk'] = { url: data.videoYaDiskUrl }
  }
  if (data.contentHash) {
    properties['Content Hash'] = { rich_text: [{ text: { content: data.contentHash } }] }
  }

  const page = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties,
    children: children.slice(0, 100), // Notion limit: 100 blocks per create
  })

  // If more than 100 blocks, append the rest
  if (children.length > 100) {
    await notion.blocks.children.append({
      block_id: page.id,
      children: children.slice(100) as any,
    })
  }

  return { id: page.id, url: (page as any).url }
}
