import { getVideoInfo, downloadAudio, formatDuration, DurationError, DownloadError } from './downloader.js'
import { transcribeAudio } from './transcriber.js'
import { generateSummary } from './summarizer.js'
import { createObsidianNote } from './obsidian.js'
import { uploadObsidianNote } from './webdav.js'
import { TEMP_DIR, YANDEX_DISK_TOKEN } from '../config.js'
import { unlinkSync, existsSync } from 'node:fs'

// --- Concurrency limiter ---

let activePipelines = 0
const MAX_CONCURRENT_PIPELINES = 2

// --- Types ---

export interface PipelineResult {
  title: string
  duration: number
  language: string
  summary: string
  noteUploaded: boolean
}

// --- Pipeline ---

export async function processMediaUrl(
  url: string,
  onProgress: (msg: string) => Promise<void>,
): Promise<PipelineResult> {
  if (activePipelines >= MAX_CONCURRENT_PIPELINES) {
    throw new Error('Конвейер занят, попробуйте позже')
  }

  activePipelines++
  let audioFilePath: string | undefined
  let notePath: string | undefined
  let transcriptPath: string | undefined

  try {
    // 1. Get video info
    await onProgress('Получаю информацию о видео...')
    const info = await getVideoInfo(url)

    // 2. Download audio
    await onProgress(`Скачиваю аудио (${formatDuration(info.duration)})...`)
    const downloadResult = await downloadAudio(url, TEMP_DIR)
    audioFilePath = downloadResult.filePath

    // 3. Transcribe
    await onProgress('Транскрибирую...')
    const transcription = await transcribeAudio(audioFilePath)

    // 4. Summarize
    await onProgress('Генерирую саммари...')
    const summary = await generateSummary(transcription.text)

    // 5. Create Obsidian note
    const note = createObsidianNote({
      title: info.title,
      sourceUrl: url,
      duration: info.duration,
      language: transcription.language,
      summary,
      textWithTimecodes: transcription.textWithTimecodes,
    })
    notePath = note.notePath
    transcriptPath = note.transcriptPath

    // 6. Upload to Yandex.Disk (only if token is configured)
    let noteUploaded = false
    if (YANDEX_DISK_TOKEN) {
      try {
        await onProgress('Загружаю заметку в Obsidian...')
        await uploadObsidianNote(
          note.notePath,
          note.transcriptPath,
          note.noteFilename,
          note.transcriptFilename,
        )
        noteUploaded = true
      } catch (err) {
        console.error('[PIPELINE] Failed to upload to Yandex.Disk:', err)
        // Non-fatal: continue without upload
      }
    }

    return {
      title: info.title,
      duration: info.duration,
      language: transcription.language,
      summary,
      noteUploaded,
    }
  } finally {
    activePipelines--

    // Cleanup temp files
    for (const path of [audioFilePath, notePath, transcriptPath]) {
      if (path && existsSync(path)) {
        try { unlinkSync(path) } catch {}
      }
    }
  }
}
