import { InlineKeyboard } from 'grammy'
import { CATEGORY_MAP, CATEGORY_TAGS } from '../config.js'

/**
 * Build Level 1 category selection keyboard.
 * 8 categories in 2-column layout + Cancel row.
 */
export function buildCategoryKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
  const entries = Object.entries(CATEGORY_MAP)
  for (let i = 0; i < entries.length; i++) {
    const [key, cat] = entries[i]!
    kb.text(cat.label, `nav:${key}`)
    if ((i + 1) % 2 === 0) kb.row()
  }
  if (entries.length % 2 !== 0) kb.row()
  kb.text('Отмена', 'nav:cancel')
  return kb
}

/**
 * Build Level 2 subcategory keyboard for a given category.
 * Shows subcategories in 2-column layout, plus back and cancel buttons.
 */
export function buildSubcategoryKeyboard(categoryKey: string): InlineKeyboard {
  const cat = CATEGORY_MAP[categoryKey]
  if (!cat || !cat.subs) {
    throw new Error(`No subcategories for category: ${categoryKey}`)
  }

  const kb = new InlineKeyboard()
  const subEntries = Object.entries(cat.subs)
  for (let i = 0; i < subEntries.length; i++) {
    const [subKey, sub] = subEntries[i]!
    kb.text(sub.label, `nav:${categoryKey}_${subKey}`)
    if ((i + 1) % 2 === 0) kb.row()
  }
  if (subEntries.length % 2 !== 0) kb.row()

  kb.text(`← Просто в ${cat.label}`, `nav:${categoryKey}_root`).row()
  kb.text('Отмена', 'nav:cancel')
  return kb
}

/**
 * Build tag selection keyboard for a category.
 * Shows category-specific tags with toggle checkmarks, done/skip/custom buttons.
 */
export function buildTagKeyboard(categoryKey: string, selectedTags: string[]): InlineKeyboard {
  const tags = CATEGORY_TAGS[categoryKey] ?? []
  const kb = new InlineKeyboard()

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!
    const prefix = selectedTags.includes(tag) ? '✅ ' : ''
    kb.text(`${prefix}${tag}`, `tag:${tag}`)
    if ((i + 1) % 2 === 0) kb.row()
  }
  if (tags.length % 2 !== 0) kb.row()

  kb.text('Без тегов', 'tag:none').text('✏️ Свой', 'tag:custom').row()
  const doneLabel = selectedTags.length > 0
    ? `Готово (${selectedTags.length})`
    : 'Готово'
  kb.text(doneLabel, 'tag:done').row()
  kb.text('Отмена', 'nav:cancel')
  return kb
}

/** Build title prompt keyboard with Skip button */
export function buildTitleKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Пропустить', 'title:skip')
}

/** Build duplicate resolution keyboard */
export function buildDuplicateKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Сохранить как новую', 'dup:new')
    .text('Отменить', 'dup:cancel')
}
