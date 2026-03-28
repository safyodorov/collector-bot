import { describe, it, expect } from 'vitest'
import { buildMarkdown, type NoteData } from '../services/markdown.js'

function makeNote(overrides: Partial<NoteData> = {}): NoteData {
  return {
    title: 'Test',
    tags: [],
    date: '2026-03-28',
    type: 'текст',
    contentHash: 'abc123',
    attachments: [],
    ...overrides,
  }
}

describe('buildMarkdown', () => {
  it('starts with --- and has closing ---', () => {
    const md = buildMarkdown(makeNote())
    const lines = md.split('\n')
    expect(lines[0]).toBe('---')
    expect(lines.indexOf('---', 1)).toBeGreaterThan(0)
  })

  it('produces tags YAML list when tags provided', () => {
    const md = buildMarkdown(makeNote({ tags: ['задача', 'важное'] }))
    expect(md).toContain('tags:\n  - задача\n  - важное')
  })

  it('produces no tags line when tags array is empty', () => {
    const md = buildMarkdown(makeNote({ tags: [] }))
    expect(md).not.toContain('tags:')
  })

  it('quotes source with colon', () => {
    const md = buildMarkdown(makeNote({ source: 'Переслано из Канал:X' }))
    expect(md).toContain('source: "Переслано из Канал:X"')
  })

  it('always includes date, type, content_hash', () => {
    const md = buildMarkdown(makeNote())
    expect(md).toContain('date: 2026-03-28')
    expect(md).toContain('type: текст')
    expect(md).toContain('content_hash: "abc123"')
  })

  it('includes text after H1 title', () => {
    const md = buildMarkdown(makeNote({ text: 'Hello world' }))
    expect(md).toContain('Hello world')
    const lines = md.split('\n')
    const h1idx = lines.findIndex(l => l.startsWith('# '))
    const textIdx = lines.indexOf('Hello world')
    expect(textIdx).toBeGreaterThan(h1idx)
  })

  it('includes image embeds for attachments', () => {
    const md = buildMarkdown(makeNote({ attachments: ['attachments/img_123.jpg'] }))
    expect(md).toContain('![](attachments/img_123.jpg)')
  })

  it('includes H1 title', () => {
    const md = buildMarkdown(makeNote({ title: 'Шарлотка' }))
    expect(md).toContain('# Шарлотка')
  })

  it('escapes double quotes in source', () => {
    const md = buildMarkdown(makeNote({ source: 'Канал "Новости"' }))
    expect(md).toContain('source: "Канал \\"Новости\\""')
  })

  it('does not use wiki-link syntax', () => {
    const md = buildMarkdown(makeNote({ attachments: ['attachments/img.jpg'] }))
    expect(md).not.toContain('![[')
  })

  it('includes video fields when provided', () => {
    const md = buildMarkdown(makeNote({
      originalUrl: 'https://youtube.com/watch?v=123',
      videoYaDiskUrl: 'https://disk.yandex.ru/d/abc',
    }))
    expect(md).toContain('video: "https://youtube.com/watch?v=123"')
    expect(md).toContain('video_yadisk: "https://disk.yandex.ru/d/abc"')
  })
})
