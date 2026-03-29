import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMP_DIR } from '../config.js'

export interface ObsidianNoteResult {
  notePath: string
  transcriptPath: string
  noteFilename: string
  transcriptFilename: string
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

function sanitizeTitle(title: string): string {
  return title.replace(/[^a-zA-Zа-яА-ЯёЁ0-9 \-]/g, '_').slice(0, 80)
}

export function createObsidianNote(params: {
  title: string
  sourceUrl: string
  duration: number
  language: string
  summary: string
  textWithTimecodes: string
  date?: string
}): ObsidianNoteResult {
  const safeTitle = sanitizeTitle(params.title)
  const date = params.date ?? new Date().toISOString().slice(0, 10)
  const durationStr = formatDuration(params.duration)

  const transcriptFilename = `${date}_${safeTitle}_transcript.md`
  const noteFilename = `${date}_${safeTitle}.md`

  // Build note content with YAML frontmatter
  const noteContent =
    '---\n' +
    `title: "${params.title.replace(/"/g, '\\"')}"\n` +
    `source: "${params.sourceUrl}"\n` +
    `date: ${date}\n` +
    `duration: "${durationStr}"\n` +
    `language: ${params.language}\n` +
    'tags:\n' +
    '  - video\n' +
    '  - transcript\n' +
    '---\n' +
    '\n' +
    `# ${params.title}\n` +
    '\n' +
    '## Summary\n' +
    '\n' +
    params.summary + '\n' +
    '\n' +
    '## Transcript\n' +
    '\n' +
    `![[${transcriptFilename}]]\n`

  // Transcript is just raw text
  const transcriptContent = params.textWithTimecodes

  // Write to temp dir
  mkdirSync(TEMP_DIR, { recursive: true })
  const notePath = resolve(TEMP_DIR, noteFilename)
  const transcriptPath = resolve(TEMP_DIR, transcriptFilename)

  writeFileSync(notePath, noteContent, 'utf-8')
  writeFileSync(transcriptPath, transcriptContent, 'utf-8')

  console.log(`[OBSIDIAN] Note written: ${notePath}`)
  console.log(`[OBSIDIAN] Transcript written: ${transcriptPath}`)

  return {
    notePath,
    transcriptPath,
    noteFilename,
    transcriptFilename,
  }
}
