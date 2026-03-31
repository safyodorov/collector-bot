export interface NoteData {
  title: string
  tags: string[]
  source?: string
  sourceUrl?: string
  originalUrl?: string
  videoYaDiskUrl?: string
  date: string
  type: string
  contentHash: string
  text?: string
  attachments: string[]
  pdfAttachment?: string
  transcriptLink?: string
}

export function buildMarkdown(data: NoteData): string {
  const lines: string[] = ['---']

  if (data.tags.length > 0) {
    lines.push('tags:')
    for (const t of data.tags) lines.push(`  - ${t}`)
  }

  if (data.source) lines.push(`source: "${escapeYaml(data.source)}"`)
  if (data.sourceUrl) lines.push(`source_url: "${escapeYaml(data.sourceUrl)}"`)
  if (data.originalUrl) lines.push(`video: "${escapeYaml(data.originalUrl)}"`)
  if (data.videoYaDiskUrl) lines.push(`video_yadisk: "${escapeYaml(data.videoYaDiskUrl)}"`)

  lines.push(`date: ${data.date}`)
  lines.push(`type: ${data.type}`)
  lines.push(`content_hash: "${data.contentHash}"`)
  if (data.transcriptLink) lines.push(`transcript: "[[${escapeYaml(data.transcriptLink)}]]"`)

  lines.push('---')
  lines.push('')

  // Source line with link before title
  if (data.source) {
    const sourceText = data.sourceUrl
      ? `[${data.source}](${data.sourceUrl})`
      : data.source
    lines.push(`> Источник: ${sourceText}`)
    lines.push('')
  }

  lines.push(`# ${data.title}`)
  lines.push('')

  // Document source block
  if (data.pdfAttachment) {
    const fname = data.pdfAttachment.split('/').pop() || 'документ'
    lines.push(`> 📄 Заметка сформирована на основе файла: [${fname}](${data.pdfAttachment})`)
    lines.push('')
  }

  for (const att of data.attachments) {
    lines.push(`![](${att})`)
  }
  if (data.attachments.length > 0) lines.push('')

  if (data.text) {
    lines.push(data.text)
    lines.push('')
  }

  return lines.join('\n')
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
