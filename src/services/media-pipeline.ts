import { getVideoInfo, downloadAudio, formatDuration, DurationError, DownloadError } from './downloader.js'
import { transcribeAudio } from './transcriber.js'
import { generateSummary } from './summarizer.js'
import { TEMP_DIR } from '../config.js'
import { unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

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

/**
 * Process a local video file: extract audio → transcribe → summarize
 */
export async function processVideoFile(
  videoBuffer: Buffer,
  title: string,
  onProgress: (msg: string) => Promise<void>,
): Promise<PipelineResult> {
  if (activePipelines >= MAX_CONCURRENT_PIPELINES) {
    throw new Error('Конвейер занят, попробуйте позже')
  }

  activePipelines++
  const videoPath = resolve(TEMP_DIR, `video_${Date.now()}.mp4`)
  const audioPath = resolve(TEMP_DIR, `audio_${Date.now()}.mp3`)

  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(videoPath, videoBuffer)

    // Extract audio with ffmpeg
    await onProgress('Извлекаю аудио из видео...')
    execSync(`ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 4 "${audioPath}" -y 2>/dev/null`, { timeout: 300_000 })

    // Get duration from ffprobe
    let duration = 0
    try {
      const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, { encoding: 'utf-8' }).trim()
      duration = Math.round(parseFloat(durationStr))
    } catch {}

    // Transcribe
    await onProgress('Транскрибирую...')
    const transcription = await transcribeAudio(audioPath)

    // Summarize
    await onProgress('Генерирую саммари...')
    const summary = await generateSummary(transcription.text)

    return {
      title,
      duration,
      language: transcription.language,
      summary,
      textWithTimecodes: transcription.textWithTimecodes,
      noteUploaded: false,
    }
  } finally {
    activePipelines--
    if (existsSync(videoPath)) try { unlinkSync(videoPath) } catch {}
    if (existsSync(audioPath)) try { unlinkSync(audioPath) } catch {}
  }
}

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
