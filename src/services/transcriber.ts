import { DeepgramClient } from '@deepgram/sdk'
import { createReadStream } from 'node:fs'
import { DEEPGRAM_API_KEY } from '../config.js'

// --- Types ---

export interface TranscriptionResult {
  text: string              // Clean text with speaker labels, no timecodes
  textWithTimecodes: string // Text with [H:MM:SS] timecodes and speaker labels
  language: string          // Detected language code
}

// --- Transcription ---

export async function transcribeAudio(
  filePath: string,
  language?: string
): Promise<TranscriptionResult> {
  if (!DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY is not set. Check your .env file.')
  }

  const client = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY })

  const requestOptions: Record<string, unknown> = {
    model: 'nova-3',
    smart_format: true,
    paragraphs: true,
    diarize: true,
  }

  if (language) {
    requestOptions.language = language
  } else {
    requestOptions.detect_language = true
  }

  console.log(`Starting transcription: ${filePath} (language=${language ?? 'auto'})`)

  let lastErr: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = createReadStream(filePath)
      const response = await client.listen.v1.media.transcribeFile(
        stream,
        requestOptions as Parameters<typeof client.listen.v1.media.transcribeFile>[1]
      )

      // Response shape: { metadata, results: { channels: [...] } }
      // Access with type assertions since SDK types use optional fields
      const res = response as unknown as {
        results: {
          channels: Array<{
            detected_language?: string
            alternatives?: Array<{
              paragraphs?: {
                paragraphs?: Array<{
                  speaker?: number
                  sentences?: Array<{ start?: number; text?: string }>
                }>
              }
            }>
          }>
        }
      }

      const channel = res.results.channels[0]
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

        // Blank line between paragraphs
        timestampedLines.push('')
        cleanLines.push('')
      }

      const textWithTimecodes = timestampedLines.join('\n').trim()
      const text = cleanLines.join('\n').trim()

      console.log(`Transcription complete. Detected language: ${detectedLang}`)

      return { text, textWithTimecodes, language: detectedLang }
    } catch (err) {
      lastErr = err
      if (attempt === 0) {
        console.warn(`Deepgram attempt 1 failed (${err}), retrying...`)
      }
    }
  }

  throw new Error(`Deepgram API error: ${lastErr}`)
}
