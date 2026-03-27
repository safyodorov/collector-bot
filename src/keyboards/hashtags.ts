import { InlineKeyboard } from 'grammy'
import { DEFAULT_HASHTAGS } from '../config.js'

/** Build category selection keyboard. Selected categories are marked with ✅ */
export function buildCategoryKeyboard(selected: Set<string>): InlineKeyboard {
  const kb = new InlineKeyboard()
  const cols = 3
  for (let i = 0; i < DEFAULT_HASHTAGS.length; i++) {
    const tag = DEFAULT_HASHTAGS[i]!
    const isSelected = selected.has(tag)
    const label = isSelected ? `✅ #${tag}` : `#${tag}`
    kb.text(label, `cat:${tag}`)
    if ((i + 1) % cols === 0) kb.row()
  }
  if (DEFAULT_HASHTAGS.length % cols !== 0) kb.row()
  kb.text('✏️ Свой', 'cat:custom').row()
  kb.text('✅ Сохранить', 'cat:save').text('❌ Отмена', 'cat:cancel')
  return kb
}

/** Build title prompt keyboard */
export function buildTitleKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Пропустить', 'title:skip')
}

/** Build duplicate resolution keyboard */
export function buildDuplicateKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Сохранить как новую', 'dup:new')
    .text('Отменить', 'dup:cancel')
}
