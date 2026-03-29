import { describe, it, expect } from 'vitest'
import { CATEGORY_MAP, CATEGORY_TAGS, type ContentType, type CategoryDef } from '../config.js'

describe('CATEGORY_MAP', () => {
  it('has 10 top-level keys', () => {
    const keys = Object.keys(CATEGORY_MAP)
    expect(keys).toHaveLength(10)
    expect(keys).toContain('бизнес')
    expect(keys).toContain('ландшафт')
    expect(keys).toContain('тос')
    expect(keys).toContain('рецепты')
    expect(keys).toContain('семья')
    expect(keys).toContain('новости')
    expect(keys).toContain('идеи')
    expect(keys).toContain('кодинг')
    expect(keys).toContain('нейросети')
    expect(keys).toContain('inbox')
  })

  it('бизнес has correct path and 7 subcategories', () => {
    const biz = CATEGORY_MAP['бизнес']!
    expect(biz.path).toBe('/Бизнес/')
    expect(biz.subs).toBeDefined()
    expect(Object.keys(biz.subs!)).toHaveLength(7)
    expect(biz.subs!['wb']!.path).toBe('/Бизнес/WB/')
  })

  it('inbox has path /Inbox/ and no subs', () => {
    const inbox = CATEGORY_MAP['inbox']!
    expect(inbox.path).toBe('/Inbox/')
    expect(inbox.subs).toBeUndefined()
  })

  it('ландшафт has 3 subcategories', () => {
    const cat = CATEGORY_MAP['ландшафт']!
    expect(cat.subs).toBeDefined()
    expect(Object.keys(cat.subs!)).toHaveLength(3)
    expect(cat.subs!['растения']!.path).toBe('/Ландшафт/Растения/')
  })

  it('новости has no subs', () => {
    expect(CATEGORY_MAP['новости']!.subs).toBeUndefined()
  })

  it('идеи has no subs', () => {
    expect(CATEGORY_MAP['идеи']!.subs).toBeUndefined()
  })
})

describe('CATEGORY_TAGS', () => {
  it('бизнес has 5 tags', () => {
    expect(CATEGORY_TAGS['бизнес']).toHaveLength(5)
  })

  it('has no inbox key', () => {
    expect(CATEGORY_TAGS['inbox']).toBeUndefined()
  })

  it('has 9 category keys', () => {
    expect(Object.keys(CATEGORY_TAGS)).toHaveLength(9)
  })
})

describe('ContentType', () => {
  it('accepts valid content types', () => {
    const types: ContentType[] = ['текст', 'фото', 'видео', 'пересланное', 'документ']
    expect(types).toHaveLength(5)
  })
})
