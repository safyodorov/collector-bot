import { Bot, Context, session, InlineKeyboard } from 'grammy'
import { BOT_TOKEN, OWNER_CHAT_ID, CATEGORY_MAP, CATEGORY_TAGS, VAULT_PATH, type ContentType } from './config.js'
import { buildCategoryKeyboard, buildSubcategoryKeyboard, buildTagKeyboard, buildTitleKeyboard, buildDuplicateKeyboard } from './keyboards/navigation.js'
import { saveEntry, findDuplicate } from './services/storage.js'
import { contentHash, urlNormalize } from './utils/content-hash.js'
import { autoTitle, detectVideoUrl, buildFilename } from './utils/text-utils.js'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs'
import { randomBytes } from 'node:crypto'
import { extractVideoUrl, formatDuration, getVideoInfo, DurationError, DownloadError } from './services/downloader.js'
import { processMediaUrl } from './services/media-pipeline.js'

// Session state
interface SessionData {
  state: 'idle' | 'awaiting_category' | 'awaiting_subcategory' | 'awaiting_tags' | 'awaiting_custom_tags' | 'awaiting_title'
  contentType: ContentType
  text: string
  source: string
  sourceUrl: string
  imageFileIds: string[]
  originalUrl: string
  selectedFolder: string      // resolved vault path e.g. "/Бизнес/WB/"
  selectedCategory: string    // category key e.g. "бизнес" (for tag lookup)
  selectedTags: string[]      // tag list
  hash: string
}

function defaultSession(): SessionData {
  return {
    state: 'idle',
    contentType: 'текст',
    text: '',
    source: '',
    sourceUrl: '',
    imageFileIds: [],
    originalUrl: '',
    selectedFolder: '',
    selectedCategory: '',
    selectedTags: [],
    hash: '',
  }
}

type MyContext = Context & { session: SessionData }

const bot = new Bot<MyContext>(BOT_TOKEN)

// Module-level buffer storage (do NOT store buffers in grammY session)
const pendingPhotos = new Map<number, Buffer[]>()
const pendingPdfs = new Map<number, { buffer: Buffer; filename: string }>()

// Media group buffering: collect all photos from a media group before processing
interface MediaGroupBuffer {
  fileIds: string[]
  caption: string
  source: string
  sourceUrl: string
  chatId: number
  ctx: MyContext   // keep last ctx for reply
  timer: ReturnType<typeof setTimeout>
}
const mediaGroupBuffers = new Map<string, MediaGroupBuffer>()

// Media pipeline: store URLs by short ID to avoid Telegram's 64-byte callback_data limit
const pendingMedia = new Map<string, string>()

async function handleMediaUrl(ctx: MyContext, url: string, chatId: number): Promise<void> {
  try {
    const info = await getVideoInfo(url)

    // Store URL by short ID (callback_data 64-byte limit)
    const id = randomBytes(6).toString('hex')
    pendingMedia.set(id, url)

    // Auto-expire after 30 minutes
    setTimeout(() => pendingMedia.delete(id), 30 * 60 * 1000)

    const keyboard = new InlineKeyboard()
      .text('Сохранить видео', `media:process:${id}`)
      .row()
      .text('Только саммари', `media:summary:${id}`)
      .row()
      .text('Не обрабатывать', `media:skip:${id}`)

    await ctx.reply(
      `Видео: ${info.title}\nДлительность: ${formatDuration(info.duration)}\n\nЧто сделать?`,
      { reply_markup: keyboard }
    )
  } catch (err) {
    if (err instanceof DurationError) {
      await ctx.reply('Видео слишком длинное (' + formatDuration(err.duration) + '). Максимум: ' + formatDuration(err.maxDuration) + '.')
    } else {
      console.error('[MEDIA] Failed to get video info:', err)
      await ctx.reply('Не удалось получить информацию о видео. Возможно, ссылка некорректна.')
    }
  }
}

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err.error || err.message || err)
})

// Log all incoming updates + catch errors in middleware
bot.use(async (ctx, next) => {
  const keys = Object.keys(ctx.update).filter(k => k !== 'update_id')
  console.log('[IN] update=%d from=%d chat=%d keys=%s text=%s', ctx.update.update_id, ctx.from?.id, ctx.chat?.id, keys.join(','), ctx.message?.text?.slice(0, 80) || ctx.message?.caption?.slice(0, 80) || ctx.callbackQuery?.data || '-')
  try {
    await next()
    console.log('[OK] update=%d processed', ctx.update.update_id)
  } catch (err: any) {
    console.error('[ERR] update=%d error=%s', ctx.update.update_id, err.message || err)
    console.error(err.stack || err)
  }
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
    'Привет! Отправь мне текст, фото, видео-ссылку или перешли сообщение — я сохраню это в Obsidian vault.\n\n' +
    '/cancel — отменить текущую операцию'
  )
})

// /cancel command
bot.command('cancel', async (ctx) => {
  pendingPhotos.delete(ctx.chat!.id)
  ctx.session = defaultSession()
  await ctx.reply('Отменено.')
})

// Extract source name + link from forwarded messages
function extractSource(origin: any): { name: string; url: string } {
  if (!origin) return { name: '', url: '' }
  if (origin.type === 'channel') {
    const title = origin.chat?.title || 'канал'
    const username = origin.chat?.username
    const url = username ? `https://t.me/${username}` : ''
    return { name: title, url }
  }
  if (origin.type === 'user') {
    const user = origin.sender_user
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'пользователь'
    const url = user?.username ? `https://t.me/${user.username}` : ''
    return { name, url }
  }
  if (origin.type === 'hidden_user') {
    return { name: origin.sender_user_name || 'скрытый пользователь', url: '' }
  }
  return { name: 'пересланное', url: '' }
}

// Handle incoming content
async function processNewContent(ctx: MyContext, contentType: ContentType, text: string, source: string, sourceUrl: string, imageFileIds: string[], originalUrl: string) {
  const hash = contentHash(text || originalUrl || imageFileIds.join(','))

  // Download photo bytes immediately (before categorization starts)
  if (imageFileIds.length > 0) {
    const buffers: Buffer[] = []
    for (const fileId of imageFileIds) {
      const file = await ctx.api.getFile(fileId)
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
      const response = await fetch(fileUrl)
      buffers.push(Buffer.from(await response.arrayBuffer()))
    }
    pendingPhotos.set(ctx.chat!.id, buffers)
  }

  // Set session state for category selection
  ctx.session.state = 'awaiting_category'
  ctx.session.contentType = contentType
  ctx.session.text = text
  ctx.session.source = source
  ctx.session.sourceUrl = sourceUrl
  ctx.session.imageFileIds = imageFileIds
  ctx.session.originalUrl = originalUrl
  ctx.session.hash = hash
  ctx.session.selectedFolder = ''
  ctx.session.selectedCategory = ''
  ctx.session.selectedTags = []

  const preview = text ? text.slice(0, 150) + (text.length > 150 ? '...' : '') : ''
  await ctx.reply(
    `Тип: ${contentType}\n${preview ? preview + '\n' : ''}\nВыберите категорию:`,
    { reply_markup: buildCategoryKeyboard() }
  )
}

// Text messages
bot.on('message:text', async (ctx) => {
  console.log('[TEXT] handler entered, state=%s, forward=%s', ctx.session.state, !!ctx.message.forward_origin)
  const s = ctx.session

  // If awaiting custom tag input
  if (s.state === 'awaiting_custom_tags') {
    const input = ctx.message.text
    const tags = input.split(',').map(t => t.replace(/^#/, '').trim()).filter(Boolean)
    for (const tag of tags) {
      if (!s.selectedTags.includes(tag)) {
        s.selectedTags.push(tag)
      }
    }
    s.state = 'awaiting_tags'
    await ctx.reply('Выберите теги:', { reply_markup: buildTagKeyboard(s.selectedCategory, s.selectedTags) })
    return
  }

  // If awaiting title
  if (s.state === 'awaiting_title') {
    await doSave(ctx, ctx.message.text.trim())
    return
  }

  // New content
  if (s.state !== 'idle') {
    console.log('[WARN] state=%s, resetting to idle for new content', s.state)
    pendingPhotos.delete(ctx.chat!.id)
    ctx.session = defaultSession()
  }

  const text = ctx.message.text

  // Media pipeline: intercept YouTube/VK/Rutube URLs for transcription+summary
  const mediaUrl = extractVideoUrl(text)
  if (mediaUrl) {
    await handleMediaUrl(ctx, mediaUrl, ctx.chat!.id)
    return
  }

  const videoUrl = detectVideoUrl(text)

  if (videoUrl) {
    const { name, url } = extractSource(ctx.message.forward_origin)
    await processNewContent(ctx, 'видео', text, name, url, [], urlNormalize(videoUrl))
  } else if (ctx.message.forward_origin) {
    const { name, url } = extractSource(ctx.message.forward_origin)
    await processNewContent(ctx, 'пересланное', text, name, url, [], '')
  } else {
    await processNewContent(ctx, 'текст', text, '', '', [], '')
  }
})

// Photo messages (with media group buffering)
bot.on('message:photo', async (ctx) => {
  const mgId = ctx.message.media_group_id
  const photo = ctx.message.photo
  const largest = photo[photo.length - 1]!
  const caption = ctx.message.caption || ''
  const { name, url } = extractSource(ctx.message.forward_origin)

  // Single photo (no media group) — process immediately
  if (!mgId) {
    if (ctx.session.state !== 'idle') {
      console.log('[WARN] state=%s, resetting to idle for new photo', ctx.session.state)
      pendingPhotos.delete(ctx.chat!.id)
      ctx.session = defaultSession()
    }
    await processNewContent(ctx, 'фото', caption, name, url, [largest.file_id], '')
    return
  }

  // Media group — buffer photos and process after 800ms of silence
  const existing = mediaGroupBuffers.get(mgId)
  if (existing) {
    // Add photo to existing buffer
    existing.fileIds.push(largest.file_id)
    if (caption) existing.caption = caption  // caption only comes with first photo
    existing.ctx = ctx  // update ctx to latest
    clearTimeout(existing.timer)
    existing.timer = setTimeout(() => flushMediaGroup(mgId), 800)
  } else {
    // Reset session for new content
    if (ctx.session.state !== 'idle') {
      console.log('[WARN] state=%s, resetting to idle for media group', ctx.session.state)
      pendingPhotos.delete(ctx.chat!.id)
      ctx.session = defaultSession()
    }
    const buf: MediaGroupBuffer = {
      fileIds: [largest.file_id],
      caption,
      source: name,
      sourceUrl: url,
      chatId: ctx.chat!.id,
      ctx,
      timer: setTimeout(() => flushMediaGroup(mgId), 800),
    }
    mediaGroupBuffers.set(mgId, buf)
  }
})

async function flushMediaGroup(mgId: string) {
  const buf = mediaGroupBuffers.get(mgId)
  if (!buf) return
  mediaGroupBuffers.delete(mgId)
  console.log('[MEDIA_GROUP] %s: %d photos, caption=%s', mgId, buf.fileIds.length, buf.caption?.slice(0, 50) || '-')
  await processNewContent(buf.ctx, 'фото', buf.caption, buf.source, buf.sourceUrl, buf.fileIds, '')
}

// Supported document MIME types for text extraction
const EXTRACTABLE_MIMES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
}

// Document messages (forwarded files, videos from channels)
bot.on(['message:document', 'message:video', 'message:animation', 'message:voice', 'message:audio'], async (ctx) => {
  const msg = ctx.message as any
  const mime = msg.document?.mime_type || ''
  const docExt = EXTRACTABLE_MIMES[mime]
  console.log('[DOC] received, doc=%s video=%s mime=%s caption=%s', !!msg.document, !!msg.video, mime, msg.caption?.slice(0, 50))

  if (ctx.session.state !== 'idle') {
    pendingPhotos.delete(ctx.chat!.id)
    pendingPdfs.delete(ctx.chat!.id)
    ctx.session = defaultSession()
  }

  const caption = msg.caption || ''
  const { name, url } = extractSource(ctx.message.forward_origin)

  // Extractable document: download, extract text to markdown, save original
  if (msg.document && docExt) {
    const docName = msg.document.file_name || `document${docExt}`
    console.log('[EXTRACT] downloading %s (%d bytes)', docName, msg.document.file_size)

    try {
      const file = await ctx.api.getFile(msg.document.file_id)
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
      const response = await fetch(fileUrl)
      const docBuffer = Buffer.from(await response.arrayBuffer())

      // Save to temp, extract via universal script
      mkdirSync('/tmp/collector-docs', { recursive: true })
      const tmpFile = `/tmp/collector-docs/${Date.now()}${docExt}`
      writeFileSync(tmpFile, docBuffer)

      try {
        let extracted = execSync(
          `node /root/collector-bot/scripts/extract-text.mjs "${tmpFile}"`,
          { timeout: 60000, maxBuffer: 50 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
        ).toString('utf8').trim()

        // Cap at 500K chars (~200 pages A4) to avoid OOM in session/save
        const MAX_TEXT = 500_000
        if (extracted.length > MAX_TEXT) {
          console.log('[EXTRACT] truncating %d → %d chars', extracted.length, MAX_TEXT)
          extracted = `> ⚠️ Документ обрезан (${Math.round(extracted.length / 1000)}K → ${MAX_TEXT / 1000}K символов). Полный текст в прикреплённом файле.\n\n` + extracted.slice(0, MAX_TEXT)
        }

        const text = caption
          ? `${caption}\n\n${extracted}`
          : extracted
        console.log('[EXTRACT] got %d chars from %s', extracted.length, docName)

        // Store file buffer for upload during save
        pendingPdfs.set(ctx.chat!.id, { buffer: docBuffer, filename: docName })

        await processNewContent(ctx, 'документ', text, name, url, [], '')
      } finally {
        try { unlinkSync(tmpFile) } catch {}
      }
    } catch (err: any) {
      console.error('[EXTRACT] failed:', err.message)
      const text = caption || docName
      await processNewContent(ctx, 'документ', text, name, url, [], '')
    }
    return
  }

  const text = caption || msg.document?.file_name || 'Документ'
  const videoUrl = detectVideoUrl(text)

  const contentType: ContentType = videoUrl ? 'видео' : 'пересланное'
  await processNewContent(ctx, contentType, text, name, url, [], videoUrl ? urlNormalize(videoUrl) : '')
})

// Callback queries
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data
  const s = ctx.session

  // --- MEDIA pipeline callbacks ---
  if (data.startsWith('media:')) {
    const parts = data.split(':')
    const action = parts[1]  // 'process', 'summary', or 'skip'
    const id = parts[2]      // short ID from pendingMedia map

    await ctx.answerCallbackQuery()

    if (action === 'skip') {
      pendingMedia.delete(id)
      await ctx.editMessageText('Обработка отменена.')
      return
    }

    const url = pendingMedia.get(id)
    pendingMedia.delete(id)

    if (!url) {
      await ctx.editMessageText('Ссылка устарела. Отправьте видео ещё раз.')
      return
    }

    const editStatus = async (text: string) => {
      try {
        await ctx.editMessageText(text)
      } catch { /* ignore edit errors */ }
    }

    try {
      const result = await processMediaUrl(url, editStatus)

      const lines = [
        result.title,
        'Длительность: ' + formatDuration(result.duration),
        'Язык: ' + result.language,
        '',
        result.summary,
      ]
      if (result.noteUploaded) {
        lines.push('', 'Заметка сохранена в Obsidian.')
      }

      const finalText = lines.join('\n')

      if (finalText.length <= 4096) {
        await ctx.editMessageText(finalText)
      } else {
        await ctx.editMessageText(finalText.slice(0, 4090) + '...')
      }

    } catch (err) {
      let errorMsg: string
      if (err instanceof DurationError) {
        errorMsg = 'Видео слишком длинное (' + formatDuration(err.duration) + '). Максимум: ' + formatDuration(err.maxDuration) + '.'
      } else if (err instanceof DownloadError) {
        errorMsg = 'Не удалось скачать видео. Возможно, оно приватное или удалено.'
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Конвейер занят')) {
          errorMsg = 'Конвейер занят обработкой других видео. Попробуйте через пару минут.'
        } else {
          errorMsg = 'Произошла ошибка при обработке видео. Попробуйте позже.'
          console.error('[MEDIA] Pipeline error:', err)
        }
      }
      await editStatus(errorMsg)
    }
    return
  }

  // Stale session guard for nav/tag callbacks
  if ((data.startsWith('nav:') || data.startsWith('tag:')) && s.state === 'idle') {
    await ctx.answerCallbackQuery('Сессия сброшена, отправьте контент заново')
    return
  }

  // --- NAV callbacks (category/subcategory selection) ---

  if (data === 'nav:cancel') {
    pendingPhotos.delete(ctx.chat!.id)
    ctx.session = defaultSession()
    await ctx.answerCallbackQuery('Отменено')
    await ctx.editMessageText('Отменено.')
    return
  }

  if (data === 'nav:inbox') {
    // Inbox quick-save: no tags, no title prompt, auto-title, save immediately
    s.selectedFolder = '/Inbox/'
    s.selectedCategory = 'inbox'
    s.selectedTags = []
    await ctx.answerCallbackQuery()
    const title = autoTitle(s.text || `${s.contentType} от ${new Date().toLocaleDateString('ru')}`)
    await doSave(ctx, title)
    return
  }

  if (data.startsWith('nav:')) {
    const payload = data.slice(4)
    await ctx.answerCallbackQuery()

    // Handle subcategory callbacks: "catKey_root" or "catKey_subKey"
    if (payload.includes('_')) {
      const underscoreIdx = payload.indexOf('_')
      const catKey = payload.slice(0, underscoreIdx)
      const subPart = payload.slice(underscoreIdx + 1)

      if (subPart === 'root') {
        // Save to category root folder
        s.selectedFolder = CATEGORY_MAP[catKey]!.path
        s.selectedCategory = catKey
        s.state = 'awaiting_tags'
        await ctx.editMessageText('Выберите теги:', { reply_markup: buildTagKeyboard(catKey, []) })
      } else {
        // Save to subcategory folder
        const sub = CATEGORY_MAP[catKey]?.subs?.[subPart]
        if (sub) {
          s.selectedFolder = sub.path
          s.selectedCategory = catKey
          s.state = 'awaiting_tags'
          await ctx.editMessageText('Выберите теги:', { reply_markup: buildTagKeyboard(catKey, []) })
        }
      }
      return
    }

    // Top-level category
    const cat = CATEGORY_MAP[payload]
    if (!cat) return

    if (cat.subs) {
      // Has subcategories: show subcategory keyboard
      s.selectedCategory = payload
      s.state = 'awaiting_subcategory'
      await ctx.editMessageText(`${cat.label} — выберите подкатегорию:`, { reply_markup: buildSubcategoryKeyboard(payload) })
    } else {
      // No subcategories (Новости, Идеи): go straight to tags
      s.selectedFolder = cat.path
      s.selectedCategory = payload
      s.state = 'awaiting_tags'
      await ctx.editMessageText('Выберите теги:', { reply_markup: buildTagKeyboard(payload, []) })
    }
    return
  }

  // --- TAG callbacks ---

  if (data === 'tag:cancel') {
    pendingPhotos.delete(ctx.chat!.id)
    ctx.session = defaultSession()
    await ctx.answerCallbackQuery('Отменено')
    await ctx.editMessageText('Отменено.')
    return
  }

  if (data === 'tag:none') {
    s.selectedTags = []
    s.state = 'awaiting_title'
    await ctx.answerCallbackQuery()
    const suggestedTitle = autoTitle(s.text || `${s.contentType} от ${new Date().toLocaleDateString('ru')}`)
    await ctx.editMessageText(
      `Теги: нет\n\nНазвание? Напишите или нажмите "Пропустить"\n(Авто: "${suggestedTitle}")`,
      { reply_markup: buildTitleKeyboard() }
    )
    return
  }

  if (data === 'tag:done') {
    s.state = 'awaiting_title'
    await ctx.answerCallbackQuery()
    const tagsDisplay = s.selectedTags.length > 0 ? s.selectedTags.map(t => '#' + t).join(' ') : 'нет'
    const suggestedTitle = autoTitle(s.text || `${s.contentType} от ${new Date().toLocaleDateString('ru')}`)
    await ctx.editMessageText(
      `Теги: ${tagsDisplay}\n\nНазвание? Напишите или нажмите "Пропустить"\n(Авто: "${suggestedTitle}")`,
      { reply_markup: buildTitleKeyboard() }
    )
    return
  }

  if (data === 'tag:custom') {
    s.state = 'awaiting_custom_tags'
    await ctx.answerCallbackQuery()
    await ctx.reply('Напишите теги через запятую:')
    return
  }

  if (data.startsWith('tag:')) {
    const tagName = data.slice(4)
    // Toggle tag
    const idx = s.selectedTags.indexOf(tagName)
    if (idx >= 0) {
      s.selectedTags.splice(idx, 1)
    } else {
      s.selectedTags.push(tagName)
    }
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: buildTagKeyboard(s.selectedCategory, s.selectedTags) })
    return
  }

  // --- TITLE callbacks ---

  if (data === 'title:skip') {
    await ctx.answerCallbackQuery()
    const title = autoTitle(s.text || `${s.contentType} от ${new Date().toLocaleDateString('ru')}`)
    await doSave(ctx, title)
    return
  }

  // --- DUP callbacks ---

  if (data === 'dup:new') {
    await ctx.answerCallbackQuery()
    // Append suffix to avoid duplicate filename
    const date = new Date().toISOString().slice(0, 10)
    const baseTitle = (ctx.session as any)._dupTitle || s.text || 'запись'
    let suffix = 2
    let filename = buildFilename(baseTitle + `_${suffix}`, date)
    while (await findDuplicate(s.selectedFolder, filename)) {
      suffix++
      filename = buildFilename(baseTitle + `_${suffix}`, date)
    }
    await doSaveWithFilename(ctx, baseTitle, filename)
    return
  }

  if (data === 'dup:cancel') {
    pendingPhotos.delete(ctx.chat!.id)
    ctx.session = defaultSession()
    await ctx.answerCallbackQuery('Отменено')
    await ctx.editMessageText('Отменено.')
    return
  }
})

// Fallback
bot.on('message', async (ctx) => {
  console.log('[FALLBACK] unhandled message type, keys=%s', Object.keys(ctx.message).join(','))
  await ctx.reply('Отправь текст, фото или перешли сообщение.')
})

/**
 * Save entry to vault. Checks for duplicates first.
 */
async function doSave(ctx: MyContext, title: string) {
  const s = ctx.session
  await ctx.reply('Сохраняю...')

  try {
    const date = new Date().toISOString().slice(0, 10)
    const filename = buildFilename(title, date)

    // Check for duplicate
    const isDup = await findDuplicate(s.selectedFolder, filename)
    if (isDup) {
      // Store title for dup:new handler
      ;(s as any)._dupTitle = title
      await ctx.reply(
        `Файл "${filename}" уже существует.\n\nСохранить как новую запись или отменить?`,
        { reply_markup: buildDuplicateKeyboard() }
      )
      return
    }

    // Prepare photo buffers
    const chatId = ctx.chat!.id
    const buffers = pendingPhotos.get(chatId) || []
    const photoBuffers = buffers.map((buffer, i) => ({
      name: `img_${Date.now()}_${contentHash(buffer.toString('base64')).slice(0, 8)}_${i}.jpg`,
      buffer,
    }))

    // Get pending PDF if any
    const pdfData = pendingPdfs.get(chatId)

    const result = await saveEntry({
      title,
      text: s.text,
      contentType: s.contentType,
      source: s.source,
      sourceUrl: s.sourceUrl,
      originalUrl: s.originalUrl,
      videoYaDiskUrl: '',
      hash: s.hash,
      folderPath: s.selectedFolder,
      tags: s.selectedTags,
    }, photoBuffers, pdfData || undefined)

    const tagsDisplay = s.selectedTags.length > 0 ? s.selectedTags.map(t => '#' + t).join(' ') : 'нет'
    const sourceDisplay = s.source ? `\nИсточник: ${s.source}${s.sourceUrl ? ' (' + s.sourceUrl + ')' : ''}` : ''
    await ctx.reply(`Сохранено: ${result.title}\n${result.path}\nТеги: ${tagsDisplay}${sourceDisplay}`)
  } catch (err: any) {
    console.error('Save error:', err)
    await ctx.reply(`Ошибка при сохранении: ${err.message}`)
  }

  pendingPhotos.delete(ctx.chat!.id)
  pendingPdfs.delete(ctx.chat!.id)
  ctx.session = defaultSession()
}

/**
 * Save with a specific filename (used for duplicate resolution with suffix).
 */
async function doSaveWithFilename(ctx: MyContext, title: string, filename: string) {
  const s = ctx.session

  try {
    const chatId = ctx.chat!.id
    const buffers = pendingPhotos.get(chatId) || []
    const photoBuffers = buffers.map((buffer, i) => ({
      name: `img_${Date.now()}_${contentHash(buffer.toString('base64')).slice(0, 8)}_${i}.jpg`,
      buffer,
    }))

    const date = new Date().toISOString().slice(0, 10)
    const notePath = `${s.selectedFolder}${filename}`

    // Upload photos
    const attachments: string[] = []
    for (const photo of photoBuffers) {
      const { putFile } = await import('./services/webdav.js')
      await putFile(`${VAULT_PATH}/attachments/${photo.name}`, new Uint8Array(photo.buffer), 'image/jpeg')
      attachments.push(`attachments/${photo.name}`)
    }

    // Build and upload markdown
    const { buildMarkdown } = await import('./services/markdown.js')
    const markdown = buildMarkdown({
      title,
      tags: s.selectedTags,
      source: s.source || undefined,
      sourceUrl: s.sourceUrl || undefined,
      originalUrl: s.originalUrl || undefined,
      videoYaDiskUrl: undefined,
      date,
      type: s.contentType,
      contentHash: s.hash,
      text: s.text || undefined,
      attachments,
    })

    const { putFile: putFileTop } = await import('./services/webdav.js')
    await putFileTop(`${VAULT_PATH}${notePath}`, markdown)

    const tagsDisplay = s.selectedTags.length > 0 ? s.selectedTags.map(t => '#' + t).join(' ') : 'нет'
    const sourceDisplay = s.source ? `\nИсточник: ${s.source}${s.sourceUrl ? ' (' + s.sourceUrl + ')' : ''}` : ''
    await ctx.reply(`Сохранено: ${title}\n${notePath}\nТеги: ${tagsDisplay}${sourceDisplay}`)
  } catch (err: any) {
    console.error('Save error:', err)
    await ctx.reply(`Ошибка при сохранении: ${err.message}`)
  }

  pendingPhotos.delete(ctx.chat!.id)
  ctx.session = defaultSession()
}

export { bot }
