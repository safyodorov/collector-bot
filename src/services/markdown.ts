export interface NoteData {
  title: string
  tags: string[]
  source?: string
  originalUrl?: string
  videoYaDiskUrl?: string
  date: string
  type: string
  contentHash: string
  text?: string
  attachments: string[]
}

export function buildMarkdown(data: NoteData): string {
  const lines: string[] = ['---']

  if (data.tags.length > 0) {
    lines.push('tags:')
    for (const t of data.tags) lines.push(`  - ${t}`)
  }

  if (data.source) lines.push(`source: "${escapeYaml(data.source)}"`)
  if (data.originalUrl) lines.push(`video: "${escapeYaml(data.originalUrl)}"`)
  if (data.videoYaDiskUrl) lines.push(`video_yadisk: "${escapeYaml(data.videoYaDiskUrl)}"`)

  lines.push(`date: ${data.date}`)
  lines.push(`type: ${data.type}`)
  lines.push(`content_hash: "${data.contentHash}"`)

  lines.push('---')
  lines.push('')

  lines.push(`# ${data.title}`)
  lines.push('')

  if (data.text) {
    lines.push(data.text)
    lines.push('')
  }

  for (const att of data.attachments) {
    lines.push(`![](${att})`)
  }

  return lines.join('\n')
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
