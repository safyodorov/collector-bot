import { Bot, Context, session } from 'grammy'
import { BOT_TOKEN, OWNER_CHAT_ID } from './config.js'
import { buildCategoryKeyboard, buildTitleKeyboard, buildDuplicateKeyboard } from './keyboards/hashtags.js'
import { createPage, findDuplicate, type ContentType } from './services/notion.js'
import { contentHash, urlNormalize } from './utils/content-hash.js'
import { autoTitle, detectVideoUrl } from './utils/text-utils.js'

// Session state
interface SessionData {
  state: 'idle' | 'awaiting_category' | 'awaiting_custom_tag' | 'awaiting_title'
  contentType: ContentType
  text: string
  source: string
  imageFileIds: string[]
  originalUrl: string
  selectedCategories: Set<string>
  hash: string
}

function defaultSession(): SessionData {
  return {
    state: 'idle',
    contentType: 'текст',
    text: '',
    source: '',
    imageFileIds: [],
    originalUrl: '',
    selectedCategories: new Set(),
    hash: '',
  }
}

type MyContext = Context & { session: SessionData }

const bot = new Bot<MyContext>(BOT_TOKEN)

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err.message || err)
})

// Log all incoming updates (first middleware)
bot.use(async (ctx, next) => {
  const keys = Object.keys(ctx.update).filter(k => k !== 'update_id')
  console.log('[IN] update=%d from=%d chat=%d keys=%s text=%s', ctx.update.update_id, ctx.from?.id, ctx.chat?.id, keys.join(','), ctx.message?.text?.slice(0, 80) || ctx.message?.caption?.slice(0, 80) || ctx.callbackQuery?.data || '-')
  await next()
})

bot.use(session({ initial: defaultSession }))

// Only allow owner
bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== OWNER_CHAT_ID) {
    await ctx.reply('Этот бот работает только для владельца.')
    return
  }
  await next()
})

// /start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Привет! Отправь мне текст, фото, видео-ссылку или перешли сообщение — я сохраню это в Notion.\n\n' +
    '/cancel — отменить текущую операцию'
  )
})

// /cancel command
bot.command('cancel', async (ctx) => {
  ctx.session = defaultSession()
  await ctx.reply('Отменено.')
})

// Handle incoming content
async function processNewContent(ctx: MyContext, contentType: ContentType, text: string, source: string, imageFileIds: string[], originalUrl: string) {
  const hash = contentHash(text || originalUrl || imageFileIds.join(','))

  // Check for duplicates
  const dup = await findDuplicate(hash)
  if (dup) {
    ctx.session.hash = hash
    ctx.session.contentType = contentType
    ctx.session.text = text
    ctx.session.source = source
    ctx.session.imageFileIds = imageFileIds
    ctx.session.originalUrl = originalUrl
    await ctx.reply(
      `⚠️ Похожая запись уже есть:\n«${dup.title}» от ${dup.date}\n\nСохранить как новую?`,
      { reply_markup: buildDuplicateKeyboard() }
    )
    return
  }

  // Show category selection
  ctx.session.state = 'awaiting_category'
  ctx.session.contentType = contentType
  ctx.session.text = text
  ctx.session.source = source
  ctx.session.imageFileIds = imageFileIds
  ctx.session.originalUrl = originalUrl
  ctx.session.hash = hash
  ctx.session.selectedCategories = new Set()

  const preview = text ? text.slice(0, 150) + (text.length > 150 ? '...' : '') : ''
  await ctx.reply(
    `📋 Тип: ${contentType}\n${preview ? preview + '\n' : ''}\nВыберите категории:`,
    { reply_markup: buildCategoryKeyboard(ctx.session.selectedCategories) }
  )
}

// Text messages
bot.on('message:text', async (ctx) => {
  const s = ctx.session

  // If awaiting custom tag input
  if (s.state === 'awaiting_custom_tag') {
    const tag = ctx.message.text.replace(/^#/, '').trim()
    if (tag) {
      s.selectedCategories.add(tag)
    }
    s.state = 'awaiting_category'
    await ctx.reply('Выберите категории:', { reply_markup: buildCategoryKeyboard(s.selectedCategories) })
    return
  }

  // If awaiting title
  if (s.state === 'awaiting_title') {
    await saveToNotion(ctx, ctx.message.text.trim())
    return
  }

  // New content
  if (s.state !== 'idle') {
    await ctx.reply('Есть незавершённая операция. /cancel чтобы отменить.')
    return
  }

  const text = ctx.message.text
  const videoUrl = detectVideoUrl(text)

  if (videoUrl) {
    await processNewContent(ctx, 'видео', text, '', [], urlNormalize(videoUrl))
  } else if (ctx.message.forward_origin) {
    const origin = ctx.message.forward_origin
    let source = 'Пересланное сообщение'
    if (origin.type === 'channel') {
      source = `Переслано из ${origin.chat.title || origin.chat.username || 'канала'}`
    } else if (origin.type === 'user') {
      source = `Переслано от ${origin.sender_user.first_name}`
    }
    await processNewContent(ctx, 'пересланное', text, source, [], '')
  } else {
    await processNewContent(ctx, 'текст', text, '', [], '')
  }
})

// Photo messages
bot.on('message:photo', async (ctx) => {
  if (ctx.session.state !== 'idle') {
    await ctx.reply('Есть незавершённая операция. /cancel чтобы отменить.')
    return
  }

  const photo = ctx.message.photo
  const largest = photo[photo.length - 1]!
  const caption = ctx.message.caption || ''
  let source = ''

  if (ctx.message.forward_origin) {
    const origin = ctx.message.forward_origin
    if (origin.type === 'channel') {
      source = `Переслано из ${origin.chat.title || 'канала'}`
    } else if (origin.type === 'user') {
      source = `Переслано от ${origin.sender_user.first_name}`
    }
  }

  await processNewContent(ctx, 'фото', caption, source, [largest.file_id], '')
})

// Callback queries for category selection
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data
  const s = ctx.session

  // Duplicate resolution
  if (data === 'dup:new') {
    s.state = 'awaiting_category'
    s.selectedCategories = new Set()
    await ctx.answerCallbackQuery()
    await ctx.editMessageText('Выберите категории:', { reply_markup: buildCategoryKeyboard(s.selectedCategories) })
    return
  }
  if (data === 'dup:cancel') {
    ctx.session = defaultSession()
    await ctx.answerCallbackQuery('Отменено')
    await ctx.editMessageText('❌ Отменено.')
    return
  }

  // Category selection
  if (data.startsWith('cat:')) {
    const action = data.slice(4)

    if (action === 'cancel') {
      ctx.session = defaultSession()
      await ctx.answerCallbackQuery('Отменено')
      await ctx.editMessageText('❌ Отменено.')
      return
    }

    if (action === 'custom') {
      s.state = 'awaiting_custom_tag'
      await ctx.answerCallbackQuery()
      await ctx.reply('Напишите хэштег (без #):')
      return
    }

    if (action === 'save') {
      if (s.selectedCategories.size === 0) {
        await ctx.answerCallbackQuery('Выберите хотя бы одну категорию')
        return
      }
      // Ask for title
      s.state = 'awaiting_title'
      const suggestedTitle = autoTitle(s.text || `${s.contentType} от ${new Date().toLocaleDateString('ru')}`)
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(
        `Категории: ${[...s.selectedCategories].map(c => '#' + c).join(' ')}\n\nНазвание? Напишите или нажмите «Пропустить»\n(Авто: «${suggestedTitle}»)`,
        { reply_markup: buildTitleKeyboard() }
      )
      return
    }

    // Toggle category
    if (s.selectedCategories.has(action)) {
      s.selectedCategories.delete(action)
    } else {
      s.selectedCategories.add(action)
    }
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: buildCategoryKeyboard(s.selectedCategories) })
    return
  }

  // Title skip
  if (data === 'title:skip') {
    await ctx.answerCallbackQuery()
    const title = autoTitle(s.text || `${s.contentType} от ${new Date().toLocaleDateString('ru')}`)
    await saveToNotion(ctx, title)
    return
  }
})

async function saveToNotion(ctx: MyContext, title: string) {
  const s = ctx.session
  await ctx.reply('⏳ Сохраняю...')

  try {
    // Download photo and get URL (for Notion external image)
    const imageUrls: string[] = []
    for (const fileId of s.imageFileIds) {
      const file = await ctx.api.getFile(fileId)
      if (file.file_path) {
        imageUrls.push(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`)
      }
    }

    const result = await createPage({
      title,
      categories: [...s.selectedCategories],
      contentType: s.contentType,
      source: s.source || undefined,
      text: s.text || undefined,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      originalUrl: s.originalUrl || undefined,
      contentHash: s.hash || undefined,
    })

    const tags = [...s.selectedCategories].map(c => '#' + c).join(' ')
    await ctx.reply(`✅ Сохранено: «${title}»\n${tags}\n${result.url}`)
  } catch (err: any) {
    console.error('Save error:', err)
    await ctx.reply(`❌ Ошибка при сохранении: ${err.message}`)
  }

  ctx.session = defaultSession()
}

export { bot }
