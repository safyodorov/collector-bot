import OpenAI from 'openai'
import { OPENAI_API_KEY, OPENAI_BASE_URL, SUMMARY_MODEL } from '../config.js'

const SUMMARY_SYSTEM_PROMPT = `Ты \u2014 профессиональный редактор и контент-аналитик. Твоя задача \u2014 составлять \
структурированные и информативные саммари на основе транскрипций видео или аудио. \
Никогда не задавай вопросов, не проси уточнений и не добавляй комментариев от себя. \
Всегда отвечай только готовым саммари, строго следуя инструкции.`

const SUMMARY_USER_PROMPT = `Составь подробное саммари по следующей транскрипции.

Структура саммари:
1. ЗАГОЛОВОК \u2014 краткое название темы (заглавными буквами).
2. КЛЮЧЕВЫЕ ТЕЗИСЫ \u2014 3\u20135 главных мыслей или выводов.
3. ПОДРОБНОЕ САММАРИ \u2014 связный текст, покрывающий все основные темы, \
аргументы и примеры из транскрипции. Объём \u2014 примерно 10\u201320% от длины оригинала. \
Разбивай на разделы с подзаголовками (заглавными буквами).
4. ЗАКЛЮЧЕНИЕ \u2014 итог или основной вывод.

Форматирование:
- Выделяй заголовки и подзаголовки ЗАГЛАВНЫМИ БУКВАМИ.
- Не используй markdown-разметку: никаких **, ##, *, _ и подобных символов.
- Используй только чистый текст, нумерованные и ненумерованные списки (с тире).
- Разделяй блоки пустыми строками для читаемости.

Стиль:
- Деловой, информативный.
- Без воды и вводных фраз вроде \u00ab\u0432 данном видео рассматривается\u2026\u00bb.
- Сохраняй ключевые термины и имена из оригинала.`

export async function generateSummary(transcriptionText: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const client = new OpenAI({
    apiKey: OPENAI_API_KEY,
    baseURL: OPENAI_BASE_URL,
  })

  console.log(`[SUMMARIZER] Generating summary with ${SUMMARY_MODEL}, text length: ${transcriptionText.length}`)

  const response = await client.chat.completions.create({
    model: SUMMARY_MODEL,
    max_completion_tokens: 16384,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: SUMMARY_USER_PROMPT + '\n\n' + transcriptionText },
    ],
  })

  const summary = response.choices[0]?.message?.content ?? ''
  console.log(`[SUMMARIZER] Summary generated, length: ${summary.length}`)
  return summary
}
