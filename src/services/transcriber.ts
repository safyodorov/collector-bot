import { readFileSync } from 'node:fs'
import { DEEPGRAM_API_KEY } from '../config.js'

// --- Types ---

export interface TranscriptionResult {
  text: string              // Clean text with speaker labels, no timecodes
  textWithTimecodes: string // Text with [H:MM:SS] timecodes and speaker labels
  language: string          // Detected language code
}

interface DeepgramParagraph {
  speaker?: number
  sentences?: Array<{ start?: number; text?: string }>
}

interface DeepgramResponse {
  results: {
    channels: Array<{
      detected_language?: string
      alternatives?: Array<{
        paragraphs?: {
          transcript?: string
          paragraphs?: DeepgramParagraph[]
        }
      }>
    }>
  }
}

// --- Transcription via REST API (matches Python reference) ---

export async function transcribeAudio(
  filePath: string,
  language?: string
): Promise<TranscriptionResult> {
  if (!DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY is not set. Check your .env file.')
  }

  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    paragraphs: 'true',
    diarize: 'true',
  })

  if (language) {
    params.set('language', language)
  } else {
    params.set('detect_language', 'true')
  }

  const url = `https://api.deepgram.com/v1/listen?${params}`
  const audioData = readFileSync(filePath)

  console.log(`[TRANSCRIBER] Starting: ${filePath} (language=${language ?? 'auto'})`)

  let lastErr: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/mpeg',
        },
        body: audioData,
        signal: AbortSignal.timeout(1800_000), // 30 min timeout
      })

      if (!resp.ok) {
        const body = await resp.text()
        throw new Error(`Deepgram HTTP ${resp.status}: ${body}`)
      }

      const data = await resp.json() as DeepgramResponse
      const channel = data.results.channels[0]
      const detectedLang = channel.detected_language ?? language ?? 'unknown'
      const paragraphs = channel.alternatives?.[0]?.paragraphs?.paragraphs ?? []

      // Build formatted text with speaker labels and timecodes
      const timestampedLines: string[] = []
      const cleanLines: string[] = []
      let currentSpeaker = -1

      for (const para of paragraphs) {
        const speaker = para.speaker
        let speakerChanged = speaker !== undefined && speaker !== currentSpeaker

        if (speakerChanged && speaker !== undefined) {
          currentSpeaker = speaker
        }

        for (const sentence of para.sentences ?? []) {
          const start = sentence.start ?? 0
          const totalSecs = Math.floor(start)
          const mins = Math.floor(totalSecs / 60) % 60
          const hours = Math.floor(totalSecs / 3600)
          const secs = totalSecs % 60

          const tc = hours
            ? `[${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`
            : `[${mins}:${String(secs).padStart(2, '0')}]`

          if (speakerChanged) {
            const label = `\nГоворящий ${currentSpeaker + 1}:`
            timestampedLines.push(label)
            cleanLines.push(label)
            speakerChanged = false
          }

          timestampedLines.push(`${tc} ${sentence.text ?? ''}`)
          cleanLines.push(sentence.text ?? '')
        }

        timestampedLines.push('')
        cleanLines.push('')
      }

      const textWithTimecodes = timestampedLines.join('\n').trim()
      const text = cleanLines.join('\n').trim()

      console.log(`[TRANSCRIBER] Complete. Language: ${detectedLang}`)

      return { text, textWithTimecodes, language: detectedLang }
    } catch (err) {
      lastErr = err
      if (attempt === 0) {
        console.warn(`[TRANSCRIBER] Attempt 1 failed (${err}), retrying...`)
      }
    }
  }

  throw new Error(`Deepgram API error: ${lastErr}`)
}
