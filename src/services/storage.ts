import { putFile, exists } from './webdav.js'
import { buildMarkdown, type NoteData } from './markdown.js'
import { buildFilename } from '../utils/text-utils.js'
import { VAULT_PATH } from '../config.js'
import type { ContentType } from '../config.js'

export interface SaveResult {
  path: string    // e.g. "/Бизнес/WB/2026-03-28_Шарлотка.md"
  title: string
}

/**
 * Check if a file already exists at the given folder + filename path.
 * Returns false on error to avoid blocking saves on PROPFIND failures.
 */
export async function findDuplicate(folderPath: string, filename: string): Promise<boolean> {
  try {
    const fullPath = `${VAULT_PATH}${folderPath}${filename}`
    return await exists(fullPath)
  } catch (err) {
    console.warn('[STORAGE] findDuplicate error, allowing save:', err)
    return false
  }
}

/**
 * Save a content entry to the vault: upload photos first, then generate and upload markdown note.
 */
export async function saveEntry(
  data: {
    title: string
    text: string
    contentType: ContentType
    source: string
    originalUrl: string
    videoYaDiskUrl: string
    hash: string
    folderPath: string       // e.g. "/Бизнес/WB/"
    tags: string[]
  },
  photoBuffers: { name: string; buffer: Buffer }[]
): Promise<SaveResult> {
  const date = new Date().toISOString().slice(0, 10)
  const filename = buildFilename(data.title, date)
  const notePath = `${VAULT_PATH}${data.folderPath}${filename}`

  // Upload photos first so attachments exist when Obsidian renders the note
  const attachments: string[] = []
  for (const photo of photoBuffers) {
    await putFile(`${VAULT_PATH}/attachments/${photo.name}`, new Uint8Array(photo.buffer), 'image/jpeg')
    attachments.push(`attachments/${photo.name}`)
  }

  // Build note data and generate markdown
  const noteData: NoteData = {
    title: data.title,
    tags: data.tags,
    source: data.source || undefined,
    originalUrl: data.originalUrl || undefined,
    videoYaDiskUrl: data.videoYaDiskUrl || undefined,
    date,
    type: data.contentType,
    contentHash: data.hash,
    text: data.text || undefined,
    attachments,
  }

  const markdown = buildMarkdown(noteData)
  await putFile(notePath, markdown)

  return { path: `${data.folderPath}${filename}`, title: data.title }
}
