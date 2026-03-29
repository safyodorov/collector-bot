# Phase 4: Media Processing Pipeline - Research

**Researched:** 2026-03-29
**Domain:** Media download, audio extraction, speech-to-text, LLM summarization, Obsidian note generation
**Confidence:** HIGH

## Summary

This phase ports the proven Python media-transcriber-bot pipeline into the existing claudeclaw TypeScript bot. The pipeline has four stages: (1) download video/audio via yt-dlp, (2) extract audio via ffmpeg, (3) transcribe via Deepgram Nova-3, (4) summarize via OpenAI-compatible LLM. The output is an Obsidian note with inline summary plus a separate transcript .md attachment, uploaded to Yandex.Disk via WebDAV.

The reference Python bot (media-transcriber-bot) provides a complete, working implementation of every stage. The TypeScript port needs three new npm dependencies (`@deepgram/sdk`, `openai`, and a yt-dlp wrapper), integration with the existing grammy bot handler, and a new service layer for the pipeline. The VPS already has ffmpeg 6.1.1 and Node.js v22 but is **missing yt-dlp** and **missing DEEPGRAM_API_KEY / OPENAI_API_KEY** in .env.

**Primary recommendation:** Use `child_process.execFile` to call yt-dlp binary directly (install via pip3 on VPS), `@deepgram/sdk` 5.0.0 for transcription, and `openai` 6.33.0 for summarization. Do NOT use npm yt-dlp wrappers -- they add unnecessary abstraction over a CLI tool that the reference bot already calls directly.

## Project Constraints (from CLAUDE.md)

- Bot framework: grammy (already in use)
- Runtime: Node.js v22, TypeScript with ES2022 target, NodeNext modules
- VPS: Ubuntu 24.04 at 212.74.231.132, PM2 process manager, 3.8GB RAM, 16GB free disk
- ffmpeg 6.1.1 available at /usr/bin/ffmpeg
- Database: better-sqlite3 (WAL mode)
- Deploy: `ssh root@212.74.231.132 'cd /root/claudeclaw && git pull && npm run build && pm2 restart claudeclaw'`
- File responses: send via Telegram API curl, then respond with `[SKIP]`
- Personality: Isha, direct and concise. No cliches, no flattery
- Config via .env file, read by src/env.ts
- Existing media handling: src/media.ts (download from Telegram, image optimization)
- Existing voice: src/voice.ts (Groq STT for short voice messages, Edge TTS)

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yt-dlp (binary) | latest via pip3 | Video/audio download from YouTube, VK, Rutube | Industry standard, reference bot uses it, supports 1000+ sites |
| @deepgram/sdk | 5.0.0 | Speech-to-text transcription | Nova-3 model, reference bot uses Deepgram, best accuracy/price ratio |
| openai | 6.33.0 | LLM summarization via OpenAI-compatible API | Reference bot uses openai SDK with custom base_url, standard approach |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ffmpeg (system) | 6.1.1 | Audio extraction from video | Already installed on VPS, called via child_process |
| ffprobe (system) | 6.1.1 | Duration/metadata extraction | Already installed on VPS |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yt-dlp binary via execFile | ytdlp-nodejs npm wrapper | Adds 3MB dependency, bundles its own binary, harder to update. Direct binary call matches reference bot pattern exactly |
| @deepgram/sdk | Raw HTTP to Deepgram API | SDK handles retries, types, auth. No reason to hand-roll |
| openai npm | Raw HTTP to OpenAI-compatible API | SDK handles streaming, retries, types. Already proven in reference bot |

**Installation:**
```bash
# On VPS:
pip3 install yt-dlp

# In project:
npm install @deepgram/sdk openai
```

**Version verification:** @deepgram/sdk@5.0.0 and openai@6.33.0 confirmed current via npm registry on 2026-03-29.

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    media-pipeline.ts    # Pipeline orchestrator (download -> extract -> transcribe -> summarize -> save)
    downloader.ts        # yt-dlp wrapper: getVideoInfo(), downloadAudio()
    transcriber.ts       # Deepgram Nova-3: transcribeAudio()
    summarizer.ts        # OpenAI-compatible LLM: generateSummary()
  bot.ts                 # Add URL detection + inline keyboard for save preferences
  config.ts              # Add DEEPGRAM_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL, MAX_DURATION_SECONDS
```

### Pattern 1: Pipeline Orchestrator
**What:** Single async function that runs the full pipeline with progress updates
**When to use:** When user sends a video URL or forwards media
**Example:**
```typescript
// Based on reference bot's handlers.py _process_audio pattern
export async function processMediaUrl(
  url: string,
  chatId: number,
  savePreference: 'video' | 'audio' | 'none',
  onProgress: (msg: string) => Promise<void>,
): Promise<PipelineResult> {
  // 1. Get video info (title, duration)
  const info = await getVideoInfo(url)
  if (info.duration > MAX_DURATION_SECONDS) throw new DurationError(info.duration)

  // 2. Download audio
  await onProgress('Скачиваю аудио...')
  const audioPath = await downloadAudio(url, TEMP_DIR)

  // 3. Transcribe
  await onProgress(`Транскрибирую (${formatDuration(info.duration)})...`)
  const transcript = await transcribeAudio(audioPath)

  // 4. Summarize
  await onProgress('Генерирую саммари...')
  const summary = await generateSummary(transcript.text)

  // 5. Create Obsidian note + transcript attachment
  // 6. Upload to Yandex.Disk
  // 7. Cleanup temp files

  return { notePath, transcriptPath }
}
```

### Pattern 2: yt-dlp via child_process (matching reference bot)
**What:** Direct binary execution, no npm wrapper
**When to use:** All video download operations
**Example:**
```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync('yt-dlp', [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    url,
  ], { timeout: 30000 })
  const info = JSON.parse(stdout)
  return { id: info.id, title: info.title, duration: info.duration ?? 0 }
}

export async function downloadAudio(url: string, outputDir: string): Promise<string> {
  const template = `${outputDir}/%(id)s.%(ext)s`
  await execFileAsync('yt-dlp', [
    '--format', 'bestaudio*/best',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '--output', template,
    '--no-warnings',
    '--quiet',
    url,
  ], { timeout: 300000 }) // 5 min timeout for large videos
  // Return the mp3 path
}
```

### Pattern 3: Deepgram Pre-recorded Transcription
**What:** File-based transcription using @deepgram/sdk v5
**Example:**
```typescript
import { createClient } from '@deepgram/sdk'

const deepgram = createClient(DEEPGRAM_API_KEY)

export async function transcribeAudio(filePath: string): Promise<TranscriptionResult> {
  const audioBuffer = readFileSync(filePath)
  const { result } = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: 'nova-3',
      smart_format: true,
      paragraphs: true,
      diarize: true,
      detect_language: true,
    }
  )
  // Extract text, timecodes, speaker labels from result
  // Follow reference bot's transcriber.py pattern for formatting
}
```

### Pattern 4: Inline Keyboard for Save Preference
**What:** When URL is detected, ask user what to keep
**Example:**
```typescript
import { InlineKeyboard } from 'grammy'

const keyboard = new InlineKeyboard()
  .text('Video', `save:video:${msgId}`)
  .text('Audio', `save:audio:${msgId}`)
  .text('Only text', `save:none:${msgId}`)

await ctx.reply(`${title} (${formatDuration(duration)})\nWhat to save?`, {
  reply_markup: keyboard,
})
```

### Pattern 5: Obsidian Note Structure
**What:** Main note with inline summary + link to transcript attachment
**Example output:**
```markdown
---
title: "Video Title"
source: "https://youtube.com/watch?v=..."
date: 2026-03-29
duration: "1h 23m 45s"
language: "ru"
tags: [video, transcript]
---

# Video Title

## Summary

[inline summary text from LLM]

## Transcript

See [[attachments/Video Title - transcript.md]]
```

### Anti-Patterns to Avoid
- **Blocking the event loop during download/transcription:** Always use child_process for yt-dlp and ffmpeg, and async SDK methods for Deepgram/OpenAI
- **Not cleaning up temp files:** Use try/finally to remove audio files even on error (reference bot does this correctly)
- **Storing large transcripts in the main note:** Transcripts can be 50-100KB. Keep them as separate .md attachments
- **Not checking duration before downloading:** Always fetch metadata first, reject videos over limit

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video download | HTTP scraping of video platforms | yt-dlp binary | Handles authentication, DRM, 1000+ sites, cookies, rate limits |
| Audio extraction | Manual ffmpeg command building | yt-dlp --extract-audio with ffmpeg postprocessor | Handles codec detection, container formats, edge cases |
| Speech-to-text | Whisper self-hosted / raw API calls | @deepgram/sdk | Nova-3 is superior accuracy, SDK handles auth/retries/types |
| LLM summarization | Custom prompt+fetch | openai SDK | Handles streaming, retries, token counting, types |
| Timecode formatting | Custom parser | Deepgram paragraphs API response | Already structured with speaker labels and timestamps |
| URL detection for video platforms | Simple regex | Comprehensive regex set from reference bot (utils.py) | Covers YouTube, VK, Rutube with all URL variants |

**Key insight:** The reference Python bot already solved every tricky edge case (duration checking, cookies, large file handling, speaker diarization formatting). Port the logic, don't reinvent it.

## Common Pitfalls

### Pitfall 1: yt-dlp Not Installed on VPS
**What goes wrong:** Pipeline fails at first step with "command not found"
**Why it happens:** yt-dlp is NOT currently installed on the VPS (verified 2026-03-29)
**How to avoid:** Add yt-dlp installation as Wave 0 / setup task: `pip3 install yt-dlp`
**Warning signs:** ENOENT error from execFile

### Pitfall 2: Missing API Keys in .env
**What goes wrong:** Deepgram/OpenAI calls fail with authentication errors
**Why it happens:** VPS .env currently has NO DEEPGRAM_API_KEY and NO OPENAI_API_KEY
**How to avoid:** Document required keys in .env.example, add setup verification, provide clear error messages
**Warning signs:** 401/403 responses from APIs

### Pitfall 3: Deepgram SDK v5 API Changes
**What goes wrong:** Code using v3 patterns fails with v5
**Why it happens:** Deepgram SDK v5 changed API surface significantly from v3
**How to avoid:** Use v5 patterns: `createClient()` not `new DeepgramClient()`, `listen.prerecorded.transcribeFile()` not `listen.v1.media.transcribe_file()`
**Warning signs:** "function not found" or "not a constructor" errors

### Pitfall 4: Large File Timeouts
**What goes wrong:** yt-dlp download or Deepgram transcription times out
**Why it happens:** Long videos (1-5 hours) produce large audio files; transcription can take minutes
**How to avoid:** Set generous timeouts: 5min for download, 30min for Deepgram (reference bot uses 1800s). Implement progress updates to keep user informed
**Warning signs:** ETIMEDOUT, AbortError

### Pitfall 5: Disk Space Exhaustion
**What goes wrong:** Temp files fill up disk
**Why it happens:** VPS has 16GB free but a 5-hour video audio can be 500MB+
**How to avoid:** Always clean up in finally blocks. Set MAX_DURATION_SECONDS to limit (reference bot uses 18000 = 5 hours). Add periodic temp dir cleanup
**Warning signs:** ENOSPC errors

### Pitfall 6: OpenAI Base URL Configuration
**What goes wrong:** Summarization calls go to wrong endpoint
**Why it happens:** Reference bot uses custom base_url (litellm.tokengate.ru/v1) for OpenAI-compatible proxy
**How to avoid:** Make base_url configurable via OPENAI_BASE_URL env var, matching reference bot pattern
**Warning signs:** Connection refused or unexpected API responses

### Pitfall 7: Concurrent Pipeline Executions
**What goes wrong:** Multiple simultaneous downloads/transcriptions overwhelm VPS resources
**Why it happens:** User sends multiple URLs in quick succession
**How to avoid:** Implement a queue or concurrency limit (existing bot already has MAX_PARALLEL_REQUESTS=5, but media pipeline is much heavier). Consider limiting media pipeline to 1-2 concurrent executions
**Warning signs:** High memory usage, OOM kills, slow responses

## Code Examples

### yt-dlp Execution with Proper Error Handling
```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface VideoInfo {
  id: string
  title: string
  duration: number
}

export class DownloadError extends Error {}
export class DurationError extends Error {
  constructor(public duration: number, public maxDuration: number) {
    super(`Video duration ${duration}s exceeds max ${maxDuration}s`)
  }
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--dump-json', '--no-download', '--no-warnings', url,
    ], { timeout: 30_000 })
    const info = JSON.parse(stdout)
    return {
      id: info.id,
      title: info.title ?? 'unknown',
      duration: Number(info.duration) || 0,
    }
  } catch (err) {
    throw new DownloadError(`Failed to get video info: ${err}`)
  }
}
```

### Deepgram v5 Transcription with Retry
```typescript
import { createClient } from '@deepgram/sdk'
import { readFileSync } from 'node:fs'

const client = createClient(DEEPGRAM_API_KEY)

export async function transcribeAudio(filePath: string): Promise<TranscriptionResult> {
  const audio = readFileSync(filePath)

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { result } = await client.listen.prerecorded.transcribeFile(audio, {
        model: 'nova-3',
        smart_format: true,
        paragraphs: true,
        diarize: true,
        detect_language: true,
      })

      const channel = result.results.channels[0]
      const detected = channel.detected_language ?? 'unknown'
      const paragraphs = channel.alternatives[0].paragraphs?.paragraphs ?? []

      // Format with timecodes and speaker labels (port from reference transcriber.py)
      const { text, textWithTimecodes } = formatTranscript(paragraphs)

      return { text, textWithTimecodes, language: detected }
    } catch (err) {
      lastError = err as Error
      if (attempt === 0) continue
    }
  }
  throw new Error(`Deepgram transcription failed: ${lastError}`)
}
```

### URL Detection (port from reference utils.py)
```typescript
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
```

### Summary Generation (port from reference summarizer.py)
```typescript
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL,
})

const SUMMARY_MODEL = 'openai/gpt-5.2' // or configurable via env

export async function generateSummary(transcriptionText: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: SUMMARY_MODEL,
    max_completion_tokens: 16384,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `${SUMMARY_USER_PROMPT}\n\n${transcriptionText}` },
    ],
  })
  return response.choices[0]?.message?.content ?? ''
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deepgram SDK v3 | Deepgram SDK v5 (createClient) | 2025 | Different API surface, new method names |
| Nova-2 | Nova-3 | Early 2025 | 47-54% better WER, multilingual codeswitching |
| youtube-dl | yt-dlp | 2021+ | youtube-dl effectively abandoned, yt-dlp is the maintained fork |
| openai SDK v3 | openai SDK v6 | 2025 | New patterns, but chat.completions.create unchanged |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | Yes | v22.22.0 | -- |
| ffmpeg | Audio extraction | Yes | 6.1.1 | -- |
| ffprobe | Duration check | Yes | 6.1.1 | -- |
| pip3 | yt-dlp install | Yes | 24.0 (Python 3.12) | -- |
| yt-dlp | Video download | **NO** | -- | Install via `pip3 install yt-dlp` |
| DEEPGRAM_API_KEY | Transcription | **NO** (not in .env) | -- | User must add to .env |
| OPENAI_API_KEY | Summarization | **NO** (not in .env) | -- | User must add to .env |
| OPENAI_BASE_URL | Summarization proxy | **NO** (not in .env) | -- | User must configure |
| Disk space | Temp files | Yes | 16GB free | -- |
| RAM | Processing | Yes | 3.8GB (2.6GB available) | -- |

**Missing dependencies with no fallback:**
- DEEPGRAM_API_KEY -- must be obtained from deepgram.com and added to VPS .env
- OPENAI_API_KEY + OPENAI_BASE_URL -- must be configured for summarization

**Missing dependencies with fallback:**
- yt-dlp -- install via `pip3 install yt-dlp` (pip3 is available, Python 3.12 installed)

## Open Questions

1. **OPENAI_BASE_URL and model name for summarization**
   - What we know: Reference bot uses `https://litellm.tokengate.ru/v1` with model `openai/gpt-5.2`
   - What's unclear: Should the claudeclaw bot use the same proxy? Is this proxy accessible from the VPS?
   - Recommendation: Make both configurable via env vars. Default to the reference bot's values

2. **Yandex.Disk WebDAV integration for notes**
   - What we know: Additional context mentions WebDAV service, but src/services/webdav.ts does not exist in the current codebase
   - What's unclear: Whether WebDAV upload is already implemented elsewhere or needs building from scratch
   - Recommendation: Research/implement WebDAV upload as part of this phase. Yandex.Disk supports WebDAV at https://webdav.yandex.ru/

3. **Obsidian vault structure on Yandex.Disk**
   - What we know: Notes should go to Obsidian vault with transcript as separate .md in attachments
   - What's unclear: Exact vault path, attachments subfolder convention
   - Recommendation: Make vault path configurable via env var (e.g., OBSIDIAN_VAULT_PATH)

4. **Cookie support for age-restricted/private videos**
   - What we know: Reference bot checks for cookies.txt file
   - What's unclear: Whether cookies are needed for the use cases Sergey cares about
   - Recommendation: Support cookies.txt optionally (same pattern as reference bot), but don't require it

5. **Deepgram SDK v5 exact API for prerecorded files**
   - What we know: v5 uses `createClient()` and has a different method chain than v3
   - What's unclear: Exact method signature for file transcription in v5 (docs show `listen.prerecorded.transcribeFile`)
   - Recommendation: Verify against @deepgram/sdk v5 types after npm install. The Python API `client.listen.v1.media.transcribe_file()` does NOT map 1:1 to the JS SDK

## Sources

### Primary (HIGH confidence)
- Reference implementation: /Users/macmini/media-transcriber-bot/ (downloader.py, transcriber.py, summarizer.py, handlers.py, config.py, utils.py)
- VPS environment verified via SSH: yt-dlp missing, ffmpeg 6.1.1 present, Node.js v22
- npm registry: @deepgram/sdk@5.0.0, openai@6.33.0 confirmed current

### Secondary (MEDIUM confidence)
- [Deepgram JS SDK GitHub](https://github.com/deepgram/deepgram-js-sdk/) - SDK patterns
- [Deepgram Nova-3 announcement](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api) - model capabilities
- [Deepgram pre-recorded docs](https://developers.deepgram.com/docs/pre-recorded-audio) - API usage

### Tertiary (LOW confidence)
- Deepgram SDK v5 exact TypeScript API surface -- needs validation after npm install

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - reference implementation exists and is proven, npm versions verified
- Architecture: HIGH - direct port of working Python code to TypeScript
- Pitfalls: HIGH - verified VPS state (missing yt-dlp, missing API keys) via SSH
- Deepgram SDK v5 API: MEDIUM - v5 method names need verification against actual types

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (30 days - stable domain, yt-dlp updates frequently but API is stable)
