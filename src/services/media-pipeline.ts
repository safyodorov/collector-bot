import { getVideoInfo, downloadAudio, formatDuration, DurationError, DownloadError } from './downloader.js'
import { transcribeAudio } from './transcriber.js'
import { generateSummary } from './summarizer.js'
import { TEMP_DIR } from '../config.js'
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
  textWithTimecodes: string
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

    return {
      title: info.title,
      duration: info.duration,
      language: transcription.language,
      summary,
      textWithTimecodes: transcription.textWithTimecodes,
      noteUploaded: false,
    }
  } finally {
    activePipelines--

    // Cleanup temp audio
    if (audioFilePath && existsSync(audioFilePath)) {
      try { unlinkSync(audioFilePath) } catch {}
    }
  }
}
