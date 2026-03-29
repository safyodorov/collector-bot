import { describe, it, expect } from 'vitest'
import { sanitizeFilename, buildFilename } from '../utils/text-utils.js'

describe('sanitizeFilename', () => {
  it('removes colon, keeps spaces', () => {
    expect(sanitizeFilename('Рецепт: Шарлотка')).toBe('Рецепт Шарлотка')
  })

  it('removes forbidden chars *"\\', () => {
    expect(sanitizeFilename('a*b"c\\d')).toBe('abcd')
  })

  it('returns fallback for empty string', () => {
    expect(sanitizeFilename('')).toBe('Без названия')
  })

  it('truncates long Cyrillic strings to <=400 bytes', () => {
    const long = 'А'.repeat(300)
    const result = sanitizeFilename(long)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(400)
  })

  it('strips trailing dots', () => {
    expect(sanitizeFilename('file...')).toBe('file')
  })

  it('strips trailing spaces', () => {
    expect(sanitizeFilename('file   ')).toBe('file')
  })
})

describe('buildFilename', () => {
  it('produces title.md format without date prefix', () => {
    expect(buildFilename('Шарлотка', '2026-03-28')).toBe('Шарлотка.md')
  })
})
