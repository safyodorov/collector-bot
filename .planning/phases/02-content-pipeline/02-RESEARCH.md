# Phase 2: Content Pipeline - Research

**Researched:** 2026-03-28
**Domain:** Telegram bot content saving pipeline (markdown generation, photo handling, two-level navigation, tags, deduplication)
**Confidence:** HIGH

## Summary

Phase 2 replaces the Notion save pipeline with an Obsidian-compatible content pipeline. The WebDAV client and vault folder structure from Phase 1 are already working. This phase wires them together: incoming Telegram content goes through a two-level category navigation (replacing the old multi-select hashtag keyboard), generates YAML-frontmatted markdown, downloads and uploads photos to WebDAV, and checks for duplicates via PROPFIND filename existence.

The biggest architectural change is the **two-level navigation system**. The current `hashtags.ts` uses a flat toggle-based multi-select with a "Save" button. The new system is a drill-down: Level 1 shows 8 category buttons, Level 2 shows subcategories (or saves immediately for leaf categories like Inbox/Новости/Идеи). This changes the state machine from `idle -> awaiting_category -> awaiting_title` to `idle -> awaiting_category -> awaiting_subcategory -> awaiting_tags -> awaiting_title -> save`.

The photo pipeline requires downloading from Telegram **immediately** on message receipt (URLs expire in ~1 hour), storing the buffer in memory or temp file, then uploading to `vault/attachments/` via WebDAV PUT after the user completes categorization. The existing `webdav.putFile()` handles binary uploads with retry and 202-polling.

Deduplication switches from Notion database queries to PROPFIND filename existence checks. The filename format `2026-03-28_Шарлотка.md` is deterministic from date + sanitized title, so checking if the file exists is sufficient.

**Primary recommendation:** Build in this order: (1) markdown generator (pure function, testable), (2) filename sanitizer, (3) two-level navigation keyboards, (4) photo download pipeline, (5) state machine updates in bot.ts, (6) dedup via PROPFIND, (7) wire everything together in a new `saveEntry()` function replacing `saveToNotion()`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MKDN-01 | Obsidian-compatible Markdown with YAML frontmatter (tags, source, date, type, content_hash) | Markdown generator pattern documented below; YAML formatting rules from Obsidian docs |
| MKDN-02 | Frontmatter uses tags list format without # (Obsidian 1.9+) | YAML list format verified: `tags:\n  - tag1\n  - tag2` |
| MKDN-03 | Note body contains text, photo refs, video links | Body template: text paragraphs + `![](attachments/file.jpg)` + source line |
| MKDN-04 | Filename from date + title: `2026-03-28_Шарлотка.md` | sanitizeFilename() spec documented below |
| MKDN-05 | Filenames sanitized (forbidden chars, ~120 char / 240 byte limit) | Byte-length truncation via `Buffer.byteLength()`, Obsidian-forbidden chars list |
| PHOT-01 | Photo downloaded from Telegram API immediately (before URL expires) | Download in message handler, store buffer in session/temp; Telegram URLs expire ~1h |
| PHOT-02 | Photo uploaded to vault/attachments/ with unique name | Use `img_{timestamp}_{hash8}.jpg` naming; `webdav.putFile()` with `image/jpeg` content type |
| PHOT-03 | Photo embedded as `![](attachments/filename.jpg)` | Standard markdown image syntax (not wiki-links) for portability |
| FOLD-03 | callback_data maps to vault path (e.g. `бизнес` -> `vault/Бизнес/`) | CATEGORY_MAP and SUBCATEGORY_MAP constants documented below |
| NAVG-01 | Level 1: 8 category buttons (Бизнес, Ландшафт, ТОС, Рецепты, Семья, Новости, Идеи, Inbox) | Keyboard builder with 2-column layout |
| NAVG-02 | Level 2: subcategories + "Просто в {категория}" back button | Per-category subcategory map; categories with subs: Бизнес(7), Ландшафт(3), ТОС(3), Семья(2), Рецепты(4) |
| NAVG-03 | Leaf categories (Новости, Идеи, Inbox) save immediately, no L2 | Check if category has subcategories; if not, skip to tags/save |
| NAVG-04 | Inbox = quick save to vault/Inbox/ without further steps | Special-case Inbox: skip tags, skip title, auto-generate title, save immediately |
| TAGS-01 | After folder selection, offer category-dependent tags | Tag sets per category documented below |
| TAGS-02 | "Без тегов" button saves without tags | Include in tag keyboard |
| TAGS-03 | "Написать свой" button lets user type custom tags comma-separated | State `awaiting_custom_tags` handles free-text input, split by comma |
| TAGS-04 | Tags in YAML frontmatter as list without # | `tags:\n  - tag1\n  - tag2` format |
| DEDU-01 | Duplicates detected by filename existence (PROPFIND) | `webdav.exists(filePath)` returns boolean; filename is deterministic from date+title |
| DEDU-02 | Duplicate found -> inline keyboard: save as new or cancel | Reuse existing `buildDuplicateKeyboard()` pattern |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack**: TypeScript, grammY, Node.js 22 -- no changes
- **No new deps**: WebDAV via native fetch, no additional npm packages
- **Storage**: WebDAV on Yandex.Disk -- sole storage backend
- **Format**: Obsidian-compatible Markdown with YAML frontmatter
- **Cyrillic**: File and folder names in Russian, must sanitize
- **Single user**: No concurrency concerns

## Standard Stack

### Core (already in project)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| grammy | ^1.30.0 | Telegram Bot API, inline keyboards, file downloads | Existing |
| node:crypto | built-in | SHA-256 content hashing | Existing |
| native fetch | built-in | WebDAV HTTP operations | Existing (webdav.ts) |

### No New Dependencies Needed

The phase requires no new npm packages. All functionality builds on:
- Existing `webdav.ts` (putFile, exists, ensureDir, getFile)
- Existing `vault.ts` (folder structure, VAULT_FOLDERS)
- grammY's `ctx.api.getFile()` for photo downloads
- Native `fetch` for downloading photo bytes from Telegram CDN

## Architecture Patterns

### New/Modified Files

```
src/
  services/
    webdav.ts          # EXISTS - no changes needed
    vault.ts           # EXISTS - no changes needed
    notion.ts          # EXISTS - being replaced (keep for now, Phase 3 removes)
    markdown.ts        # NEW - Obsidian markdown generator (pure function)
    storage.ts         # NEW - high-level save/dedup orchestrator
  keyboards/
    hashtags.ts        # REWRITE - two-level navigation replacing flat multi-select
  utils/
    text-utils.ts      # MODIFY - add sanitizeFilename()
    content-hash.ts    # EXISTS - no changes needed
  bot.ts               # MODIFY - new state machine, new save function, photo download
  config.ts            # MODIFY - add category/tag constants, remove DEFAULT_HASHTAGS usage
```

### Pattern 1: Two-Level Navigation Keyboard

**What:** Replace flat hashtag multi-select with drill-down category -> subcategory selection.

**callback_data mapping:**

```typescript
// Level 1 callbacks: "nav:{category_key}"
// Level 2 callbacks: "nav:{category_key}_{subcategory_key}"
// Special: "nav:inbox" saves immediately

const CATEGORY_MAP: Record<string, { label: string; path: string; subs?: Record<string, { label: string; path: string }> }> = {
  бизнес: {
    label: 'Бизнес', path: '/Бизнес/',
    subs: {
      wb: { label: 'WB', path: '/Бизнес/WB/' },
      ozon: { label: 'Ozon', path: '/Бизнес/Ozon/' },
      поставщики: { label: 'Поставщики', path: '/Бизнес/Поставщики/' },
      финансы: { label: 'Финансы', path: '/Бизнес/Финансы/' },
      аналитика: { label: 'Аналитика', path: '/Бизнес/Аналитика/' },
      контент: { label: 'Контент', path: '/Бизнес/Контент/' },
      налоги: { label: 'Налоги', path: '/Бизнес/Налоги/' },
    }
  },
  ландшафт: {
    label: 'Ландшафт', path: '/Ландшафт/',
    subs: {
      растения: { label: 'Растения', path: '/Ландшафт/Растения/' },
      проекты: { label: 'Проекты', path: '/Ландшафт/Проекты/' },
      благоустройство: { label: 'Благоустройство', path: '/Ландшафт/Благоустройство/' },
    }
  },
  тос: {
    label: 'ТОС', path: '/ТОС/',
    subs: {
      документы: { label: 'Документы', path: '/ТОС/Документы/' },
      протоколы: { label: 'Протоколы', path: '/ТОС/Протоколы/' },
      инициативы: { label: 'Инициативы', path: '/ТОС/Инициативы/' },
    }
  },
  рецепты: {
    label: 'Рецепты', path: '/Рецепты/',
    subs: {
      супы: { label: 'Супы', path: '/Рецепты/Супы/' },
      мясо: { label: 'Мясо', path: '/Рецепты/Мясо/' },
      выпечка: { label: 'Выпечка', path: '/Рецепты/Выпечка/' },
      напитки: { label: 'Напитки', path: '/Рецепты/Напитки/' },
    }
  },
  семья: {
    label: 'Семья', path: '/Семья/',
    subs: {
      дети: { label: 'Дети', path: '/Семья/Дети/' },
      дом: { label: 'Дом', path: '/Семья/Дом/' },
    }
  },
  новости: { label: 'Новости', path: '/Новости/' },
  идеи: { label: 'Идеи', path: '/Идеи/' },
  inbox: { label: 'Inbox', path: '/Inbox/' },
}
```

**Keyboard layout (Level 1):**
```
[ Бизнес    ] [ Ландшафт ]
[ ТОС       ] [ Рецепты  ]
[ Семья     ] [ Новости  ]
[ Идеи      ] [ Inbox    ]
[        Отмена          ]
```

**Keyboard layout (Level 2, example: Бизнес):**
```
[ WB          ] [ Ozon       ]
[ Поставщики  ] [ Финансы    ]
[ Аналитика   ] [ Контент    ]
[ Налоги      ]
[ <- Просто в Бизнес        ]
[        Отмена              ]
```

**State flow:**
- User taps "Бизнес" -> callback `nav:бизнес` -> show subcategory keyboard
- User taps "WB" -> callback `nav:бизнес_wb` -> folder resolved to `/Бизнес/WB/` -> proceed to tags
- User taps "Просто в Бизнес" -> callback `nav:бизнес` with `_root` suffix -> folder `/Бизнес/` -> proceed to tags
- User taps "Новости" -> callback `nav:новости` -> no subs -> proceed to tags (or save directly)
- User taps "Inbox" -> callback `nav:inbox` -> save immediately, no tags, auto-title

### Pattern 2: Category-Dependent Tags

**What:** After folder is selected, show relevant tags based on category.

```typescript
const CATEGORY_TAGS: Record<string, string[]> = {
  бизнес: ['аналитика', 'задача', 'идея', 'важное', 'финансы'],
  ландшафт: ['растения', 'проект', 'покупка', 'сезонное'],
  тос: ['протокол', 'решение', 'жалоба', 'проект'],
  рецепты: ['быстрый', 'сложный', 'десерт', 'здоровое'],
  семья: ['школа', 'здоровье', 'покупка', 'событие'],
  новости: ['политика', 'экономика', 'технологии', 'местное'],
  идеи: ['проект', 'бизнес', 'дом', 'хобби'],
}
// Inbox has no tags -- saves immediately
```

**Tag keyboard:**
```
[ аналитика ] [ задача ]
[ идея      ] [ важное ]
[ финансы   ]
[ Без тегов          ]
[ Написать свой      ]
```

Tags are multi-select (toggle on/off like old categories), then "Готово" to proceed to title.

### Pattern 3: Markdown Generator (Pure Function)

**What:** `buildMarkdown()` takes structured data, returns Obsidian-compatible string.

```typescript
// src/services/markdown.ts

export interface NoteData {
  title: string
  tags: string[]           // without #
  source?: string          // "Переслано из канала X"
  originalUrl?: string     // video URL
  videoYaDiskUrl?: string  // yadisk video link
  date: string             // YYYY-MM-DD
  type: string             // текст | фото | видео | пересланное
  contentHash: string      // sha256
  text?: string            // note body text
  attachments: string[]    // ["attachments/img_xxx.jpg"]
}

export function buildMarkdown(data: NoteData): string {
  const lines: string[] = ['---']

  // Tags
  if (data.tags.length > 0) {
    lines.push('tags:')
    for (const t of data.tags) lines.push(`  - ${t}`)
  }

  // Source (always quote -- may contain colons)
  if (data.source) lines.push(`source: "${escapeYaml(data.source)}"`)

  // Video URL
  if (data.originalUrl) lines.push(`video: "${escapeYaml(data.originalUrl)}"`)
  if (data.videoYaDiskUrl) lines.push(`video_yadisk: "${escapeYaml(data.videoYaDiskUrl)}"`)

  // Date, type, hash
  lines.push(`date: ${data.date}`)
  lines.push(`type: ${data.type}`)
  lines.push(`content_hash: "${data.contentHash}"`)

  lines.push('---')
  lines.push('')

  // H1 title
  lines.push(`# ${data.title}`)
  lines.push('')

  // Body text
  if (data.text) {
    lines.push(data.text)
    lines.push('')
  }

  // Photo embeds
  for (const att of data.attachments) {
    lines.push(`![](${att})`)
  }

  return lines.join('\n')
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
```

### Pattern 4: Photo Download Pipeline

**What:** Download photo bytes immediately when message arrives, before user starts categorizing.

```typescript
// In bot.ts photo handler:

// 1. Download immediately
const file = await ctx.api.getFile(largest.file_id)
const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
const response = await fetch(fileUrl)
const buffer = Buffer.from(await response.arrayBuffer())

// 2. Store buffer reference (in session or module-level Map)
// Option A: Store in a Map keyed by chat_id (cleaned up on save/cancel)
const pendingPhotos = new Map<number, Buffer[]>()

// 3. On save: upload to WebDAV
const hash8 = contentHash(buffer.toString('base64')).slice(0, 8)
const photoName = `img_${Date.now()}_${hash8}.jpg`
await putFile(`${VAULT_PATH}/attachments/${photoName}`, buffer, 'image/jpeg')
```

**Critical timing:** Photo MUST be downloaded in the message handler, NOT in saveEntry(). Telegram file URLs expire in ~1 hour. The user may spend minutes selecting categories and typing a title.

### Pattern 5: Filename Sanitization

```typescript
// Add to src/utils/text-utils.ts

const FORBIDDEN_CHARS = /[*"\\/<>:|?#^\[\]]/g

export function sanitizeFilename(title: string, maxBytes = 200): string {
  let name = title
    .replace(FORBIDDEN_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '_')

  if (!name || name === '.' || name === '..') {
    name = 'Без-названия'
  }

  // Truncate to maxBytes at character boundary
  while (Buffer.byteLength(name, 'utf8') > maxBytes) {
    name = name.slice(0, -1)
  }

  // Remove trailing dots/underscores
  name = name.replace(/[._]+$/, '')

  return name || 'Без-названия'
}

export function buildFilename(title: string, date: string): string {
  const sanitized = sanitizeFilename(title)
  return `${date}_${sanitized}.md`
}
```

### Pattern 6: Deduplication via PROPFIND

```typescript
// In storage.ts

export async function findDuplicate(
  folderPath: string,
  filename: string
): Promise<boolean> {
  const fullPath = `${VAULT_PATH}${folderPath}${filename}`
  return exists(fullPath)
}
```

When duplicate found, show keyboard with "Сохранить как новую" (appends `_2`, `_3` etc.) or "Отменить".

### Pattern 7: Updated State Machine

```
idle
  |
  | (user sends content)
  v
processNewContent()
  |-- download photo immediately if present
  |-- compute hash
  |
  v
awaiting_category  (Level 1 keyboard: 8 categories)
  |
  |-- tap category with subs -> awaiting_subcategory (Level 2 keyboard)
  |-- tap leaf category (Новости/Идеи) -> awaiting_tags
  |-- tap Inbox -> save immediately (auto-title, no tags)
  |
awaiting_subcategory  (Level 2 keyboard)
  |
  |-- tap subcategory -> awaiting_tags
  |-- tap "Просто в {cat}" -> awaiting_tags (parent folder)
  |
awaiting_tags  (Tag selection keyboard)
  |
  |-- toggle tags
  |-- "Без тегов" -> awaiting_title
  |-- "Написать свой" -> awaiting_custom_tags -> back to awaiting_tags
  |-- "Готово" -> awaiting_title
  |
awaiting_custom_tags
  |
  | (user types comma-separated tags)
  v
awaiting_tags (with new tags added)
  |
awaiting_title
  |
  |-- user types title -> saveEntry()
  |-- "Пропустить" -> saveEntry(autoTitle)
  |
  v
save -> idle
```

**SessionData changes:**
```typescript
interface SessionData {
  state: 'idle' | 'awaiting_category' | 'awaiting_subcategory' | 'awaiting_tags' | 'awaiting_custom_tags' | 'awaiting_title'
  contentType: ContentType
  text: string
  source: string
  imageFileIds: string[]
  originalUrl: string
  selectedFolder: string       // NEW: resolved vault path e.g. "/Бизнес/WB/"
  selectedCategory: string     // NEW: category key e.g. "бизнес" (for tag lookup)
  selectedTags: string[]       // RENAMED from selectedCategories
  hash: string
}
```

### Anti-Patterns to Avoid

- **Do NOT use wiki-link syntax `![[file]]`** for images. Use standard markdown `![](path)` for portability.
- **Do NOT store photo buffers in session**. grammY sessions are serialized; Buffers would bloat memory. Use a separate `Map<number, Buffer[]>` keyed by `ctx.chat.id`.
- **Do NOT delay photo download** to save time. Download immediately in the message handler.
- **Do NOT use an index file for dedup**. PROPFIND filename check is simpler and avoids the Remotely Save conflict risk documented in pitfalls research.
- **Do NOT create a StorageService interface**. Direct replacement of notion.ts with storage.ts. No abstraction layer needed for a single backend.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter | Generic YAML serializer | Simple string template with `escapeYaml()` | Only 7-8 fields, always the same structure, no nesting |
| Photo download | Custom HTTP client | `fetch()` + `Buffer.from(arrayBuffer)` | Built into Node 22, one-liner |
| Dedup index file | JSON index on WebDAV | PROPFIND filename existence check | Avoids sync conflicts, simpler, no state to maintain |
| Keyboard builders | Generic keyboard factory | Purpose-built functions per level | Only 3 keyboard types, each is unique |

## Common Pitfalls

### Pitfall 1: Photo URL Expiry During Categorization
**What goes wrong:** User sends photo, spends 5+ minutes selecting category/subcategory/tags/title. By save time, Telegram file URL has expired. Photo download fails.
**Why it happens:** Telegram Bot API file URLs expire after ~1 hour. The old code downloaded at save time because Notion fetched immediately.
**How to avoid:** Download photo bytes in the message handler, store in memory. Upload to WebDAV from buffer during save.
**Warning signs:** `403 Forbidden` or empty response when fetching Telegram file URL.

### Pitfall 2: callback_data Length Limit
**What goes wrong:** Telegram limits `callback_data` to 64 bytes. Cyrillic callback data like `nav:благоустройство` is 37 bytes in UTF-8 -- fits, but barely. Compound keys like `nav:ландшафт_благоустройство` would be 51 bytes -- still fits but leaves little room.
**Why it happens:** Telegram enforces 1-64 byte limit on callback_data.
**How to avoid:** Keep callback_data keys short. Use transliterated or abbreviated keys if needed. Current scheme (`nav:бизнес_wb`) stays well within limits.
**Warning signs:** Telegram API error "BUTTON_DATA_INVALID" on keyboard send.

### Pitfall 3: YAML Special Characters in Titles
**What goes wrong:** A title like `Рецепт: Шарлотка` breaks YAML parsing. Obsidian shows raw frontmatter instead of parsed properties.
**Why it happens:** Unquoted YAML strings with colons are parsed as key-value pairs.
**How to avoid:** Never put `title` in frontmatter (the H1 heading serves as title). For `source`, always double-quote the value and escape internal quotes.
**Warning signs:** Obsidian Properties panel shows parsing errors or raw YAML text.

### Pitfall 4: Stale Session After Bot Restart
**What goes wrong:** User is mid-categorization, bot restarts (PM2), session lost. User taps a category button but session is empty -- crash or confusing behavior.
**Why it happens:** In-memory sessions don't survive restarts.
**How to avoid:** In callback handler, check `session.state` before processing. If state is `idle` but callback is `nav:*`, reply "Сессия сброшена, отправьте контент заново" and ignore.
**Warning signs:** Unhandled callback queries, user stuck with non-responsive buttons.

### Pitfall 5: Multiple Photos in One Message
**What goes wrong:** Telegram sends photo albums as individual messages, each with a different `file_id`. The bot processes each as separate content items.
**Why it happens:** Telegram Bot API delivers album items as separate updates, each with `media_group_id`.
**How to avoid:** For Phase 2, handle single photos only. If `media_group_id` is present, take only the first photo (by checking if we already have a pending save for this `media_group_id`). Multi-photo support can be added later.
**Warning signs:** User sends 3-photo album, bot creates 3 separate notes.

### Pitfall 6: WebDAV 202 Async Upload for Photos
**What goes wrong:** Large photos (5MB+) trigger Yandex's async processing. PUT returns 202, but the file isn't ready yet. Markdown references a non-existent attachment.
**Why it happens:** Yandex WebDAV processes large uploads asynchronously.
**How to avoid:** The existing `putFile()` in webdav.ts already handles 202 with polling. Ensure photo upload completes (putFile returns successfully) BEFORE uploading the markdown note.
**Warning signs:** `putFile` throws after 30s polling timeout.

## Code Examples

### Complete saveEntry() Flow

```typescript
// src/services/storage.ts

import { putFile, exists } from './webdav.js'
import { buildMarkdown, type NoteData } from './markdown.js'
import { sanitizeFilename, buildFilename } from '../utils/text-utils.js'
import { VAULT_PATH } from '../config.js'

export interface SaveResult {
  path: string
  title: string
}

export async function saveEntry(
  data: {
    title: string
    text: string
    contentType: string
    source: string
    originalUrl: string
    hash: string
    folderPath: string       // e.g. "/Бизнес/WB/"
    tags: string[]
  },
  photoBuffers: { name: string; buffer: Buffer }[]
): Promise<SaveResult> {
  const date = new Date().toISOString().slice(0, 10)
  const filename = buildFilename(data.title, date)
  const notePath = `${VAULT_PATH}${data.folderPath}${filename}`

  // 1. Upload photos first
  const attachments: string[] = []
  for (const photo of photoBuffers) {
    const attPath = `${VAULT_PATH}/attachments/${photo.name}`
    await putFile(attPath, photo.buffer, 'image/jpeg')
    attachments.push(`attachments/${photo.name}`)
  }

  // 2. Generate markdown
  const noteData: NoteData = {
    title: data.title,
    tags: data.tags,
    source: data.source || undefined,
    originalUrl: data.originalUrl || undefined,
    date,
    type: data.contentType,
    contentHash: data.hash,
    text: data.text || undefined,
    attachments,
  }
  const markdown = buildMarkdown(noteData)

  // 3. Upload markdown
  await putFile(notePath, markdown)

  return { path: `${data.folderPath}${filename}`, title: data.title }
}
```

### Keyboard Builder Example

```typescript
// src/keyboards/navigation.ts

import { InlineKeyboard } from 'grammy'
import { CATEGORY_MAP } from '../config.js'

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

export function buildSubcategoryKeyboard(categoryKey: string): InlineKeyboard {
  const cat = CATEGORY_MAP[categoryKey]
  if (!cat?.subs) throw new Error(`No subcategories for ${categoryKey}`)

  const kb = new InlineKeyboard()
  const entries = Object.entries(cat.subs)
  for (let i = 0; i < entries.length; i++) {
    const [subKey, sub] = entries[i]!
    kb.text(sub.label, `nav:${categoryKey}_${subKey}`)
    if ((i + 1) % 2 === 0) kb.row()
  }
  if (entries.length % 2 !== 0) kb.row()
  kb.text(`\u2190 Просто в ${cat.label}`, `nav:${categoryKey}_root`).row()
  kb.text('Отмена', 'nav:cancel')
  return kb
}
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 2) | Impact |
|------------------------|----------------------|--------|
| Flat multi-select hashtags | Two-level category drill-down | Cleaner UX, maps to vault folder structure |
| Notion database query for dedup | PROPFIND filename existence | No index file to maintain |
| Telegram URL passed to Notion | Photo downloaded to buffer, PUT to WebDAV | Eliminates URL expiry risk |
| Notion blocks (paragraph, image, bookmark) | Markdown with YAML frontmatter | Obsidian-native format |
| `saveToNotion()` | `saveEntry()` via storage.ts | Clean separation of concerns |

## Open Questions

1. **Tag sets per category**
   - What we know: Tags should be category-dependent per spec. The spec does not list specific tags per category.
   - What's unclear: Exact tag lists for each category.
   - Recommendation: Start with 4-5 reasonable tags per category (documented above). User can always use "Написать свой" for custom tags. Tag lists can be adjusted post-launch easily since they're just config constants.

2. **Media group (album) handling**
   - What we know: Telegram sends album photos as separate messages with `media_group_id`.
   - What's unclear: Whether to combine them into one note or treat as separate notes.
   - Recommendation: Phase 2 treats each photo message independently. Album grouping is a v2 enhancement.

3. **Inbox quick-save behavior**
   - What we know: Inbox should save immediately without further steps.
   - What's unclear: Should Inbox skip tags AND title, or just tags?
   - Recommendation: Skip both. Auto-generate title from content, save with no tags to `vault/Inbox/`. Fastest possible path.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/bot.ts`, `src/services/notion.ts`, `src/keyboards/hashtags.ts`, `src/services/webdav.ts`, `src/services/vault.ts`
- `.planning/research/ARCHITECTURE.md` -- module design, photo pipeline, error handling patterns
- `.planning/research/FEATURES.md` -- Obsidian note format spec, YAML rules, image embedding
- `.planning/research/PITFALLS.md` -- Yandex WebDAV 202/429 issues, photo URL expiry, filename encoding
- `.planning/REQUIREMENTS.md` -- all 19 requirement IDs for Phase 2

### Secondary (MEDIUM confidence)
- `.planning/codebase/ARCHITECTURE.md` -- session state machine documentation
- `.planning/codebase/CONCERNS.md` -- photo handling migration concerns, dedup approach

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new deps, all existing tools
- Architecture: HIGH - clear patterns from existing codebase + research docs
- Navigation/keyboards: HIGH - spec is explicit about categories and subcategories
- Photo pipeline: HIGH - well-documented in pitfalls research, webdav.ts already handles binary PUT
- Dedup approach: HIGH - PROPFIND exists() already implemented and tested in Phase 1
- Tag sets: MEDIUM - exact per-category tags not specified in requirements, using reasonable defaults

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable -- no external API changes expected)
