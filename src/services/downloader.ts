import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAX_DURATION_SECONDS, TEMP_DIR, PROJECT_ROOT } from '../config.js'

const execFileAsync = promisify(execFile)

// --- Types ---

export interface VideoInfo {
  id: string
  title: string
  duration: number // seconds
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DownloadError'
  }
}

export class DurationError extends Error {
  duration: number
  maxDuration: number
  constructor(duration: number, maxDuration: number) {
    super(`Video duration ${duration}s exceeds max ${maxDuration}s`)
    this.name = 'DurationError'
    this.duration = duration
    this.maxDuration = maxDuration
  }
}

// --- URL Detection ---

const YOUTUBE_RE = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
const VK_VIDEO_RE = /(?:https?:\/\/)?(?:www\.|m\.)?(?:vk\.com\/(?:video|clip)|vkvideo\.ru\/video)[-\d_]+/
const RUTUBE_RE = /(?:https?:\/\/)?(?:www\.)?rutube\.ru\/video\/[\w]+/

export function extractVideoUrl(text: string): string | null {
  for (const re of [YOUTUBE_RE, VK_VIDEO_RE, RUTUBE_RE]) {
    const match = re.exec(text)
    if (match) return match[0]
  }
  return null
}

// --- Video Info ---

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--dump-json', '--no-download', '--no-warnings', url],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
    )
    const info = JSON.parse(stdout)
    return {
      id: info.id,
      title: info.title ?? 'unknown',
      duration: Number(info.duration) || 0,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new DownloadError(`Failed to get video info: ${msg}`)
  }
}

// --- Download Audio ---

export async function downloadAudio(
  url: string,
  outputDir: string = TEMP_DIR
): Promise<{ filePath: string; info: VideoInfo }> {
  const info = await getVideoInfo(url)

  if (info.duration > MAX_DURATION_SECONDS) {
    throw new DurationError(info.duration, MAX_DURATION_SECONDS)
  }

  const args = [
    '--format', 'bestaudio*/best',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '--output', `${outputDir}/%(id)s.%(ext)s`,
    '--no-warnings',
    '--quiet',
  ]

  const cookiesPath = resolve(PROJECT_ROOT, 'cookies.txt')
  if (existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath)
  }

  args.push(url)

  try {
    await execFileAsync('yt-dlp', args, { timeout: 300_000 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new DownloadError(`Failed to download audio: ${msg}`)
  }

  const filePath = resolve(outputDir, `${info.id}.mp3`)
  if (!existsSync(filePath)) {
    throw new DownloadError(`Audio file not found after download: ${filePath}`)
  }

  console.log(`Downloaded audio: ${info.title} (${info.duration}s)`)
  return { filePath, info }
}

// --- Format Duration ---

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (h) parts.push(`${h}ч`)
  if (m) parts.push(`${m}м`)
  if (s || !parts.length) parts.push(`${s}с`)
  return parts.join(' ')
}
