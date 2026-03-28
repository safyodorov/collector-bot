import { describe, it, expect } from 'vitest'
import { sanitizeFilename, buildFilename } from '../utils/text-utils.js'

describe('sanitizeFilename', () => {
  it('removes colon and replaces space with underscore', () => {
    expect(sanitizeFilename('Рецепт: Шарлотка')).toBe('Рецепт_Шарлотка')
  })

  it('removes forbidden chars *"\\', () => {
    expect(sanitizeFilename('a*b"c\\d')).toBe('abcd')
  })

  it('returns Без-названия for empty string', () => {
    expect(sanitizeFilename('')).toBe('Без-названия')
  })

  it('truncates long Cyrillic strings to <=200 bytes', () => {
    const long = 'А'.repeat(300)
    const result = sanitizeFilename(long)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200)
  })

  it('strips trailing dots', () => {
    expect(sanitizeFilename('file...')).toBe('file')
  })

  it('strips trailing underscores after space replacement', () => {
    expect(sanitizeFilename('file   ')).toBe('file')
  })
})

describe('buildFilename', () => {
  it('produces date_title.md format', () => {
    expect(buildFilename('Шарлотка', '2026-03-28')).toBe('2026-03-28_Шарлотка.md')
  })
})
