# Phase 4: Media Pipeline - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning
**Source:** Conversation with user + media-transcriber-bot analysis

<domain>
## Phase Boundary

Add media processing to the collector bot: detect video/audio URLs and files, download via yt-dlp, extract audio, transcribe via Deepgram, summarize via LLM, save results as Obsidian notes with attachments on Yandex.Disk.

Reference implementation: /Users/macmini/media-transcriber-bot (Python bot with same pipeline)
</domain>

<decisions>
## Implementation Decisions

### Media Detection
- Bot detects YouTube, VK Video, Rutube URLs in text messages and forwarded messages
- Bot detects audio/video files sent directly (mp3, wav, mp4, etc.)
- Instagram NOT supported (unstable with yt-dlp), consider Cobalt.tools API as future option

### Download Options (user choice per media)
- Bot MUST ask user before downloading: "Сохранить видео / Сохранить аудио / Не сохранять медиа"
- "Сохранить видео" — download full video, upload to attachments/
- "Сохранить аудио" — extract MP3 audio only, upload to attachments/
- "Не сохранять медиа" — only keep URL link in the note, no file download to Yandex.Disk

### Transcription
- Use Deepgram Nova-3 API (same as media-transcriber-bot)
- Support diarization (speaker detection)
- Support timecodes
- Output: markdown file with timestamped transcript
- Save as separate .md file in attachments/ (not inline in note — too large)
- DEEPGRAM_API_KEY in .env

### Summarization
- Use OpenAI-compatible API via LiteLLM (same as media-transcriber-bot)
- Structured summary: heading, key theses, detailed summary, conclusion
- Output: markdown (not DOCX — we're in Obsidian ecosystem)
- Summary goes INTO the main note body
- OPENAI_API_KEY and OPENAI_BASE_URL in .env

### Note Structure
- Main note contains:
  1. Source link (YouTube/VK/etc URL)
  2. Summary (inline markdown)
  3. Link to transcript .md file in attachments/
  4. Link to saved media file (if user chose to save)
- Transcript saved as separate `attachments/transcript_{hash}_{title}.md`
- Media file (if saved) as `attachments/media_{hash}_{title}.mp3/mp4`

### Architecture
- Port Python logic from media-transcriber-bot to TypeScript/Node.js
- Use yt-dlp CLI (already on VPS) for video download
- Use ffmpeg (already on VPS) for audio extraction
- Use Deepgram SDK for Node.js (npm: @deepgram/sdk)
- Use OpenAI SDK for Node.js (npm: openai) for summarization
- New modules: src/services/media.ts (download + extract), src/services/transcribe.ts, src/services/summarize.ts
- Integration point: bot.ts document handler + text URL detection

### Claude's Discretion
- Exact yt-dlp flags and format selection
- Retry logic for API calls
- Temp file cleanup strategy
- Progress notification timing
- Maximum video duration limit

</decisions>

<canonical_refs>
## Canonical References

### Reference Implementation
- `/Users/macmini/media-transcriber-bot/downloader.py` — yt-dlp download logic
- `/Users/macmini/media-transcriber-bot/transcriber.py` — Deepgram API integration
- `/Users/macmini/media-transcriber-bot/summarizer.py` — LLM summarization prompt
- `/Users/macmini/media-transcriber-bot/handlers.py` — Pipeline orchestration
- `/Users/macmini/media-transcriber-bot/config.py` — Environment config

### Current Bot
- `src/bot.ts` — Main bot, document handler, URL detection
- `src/services/storage.ts` — Save to Yandex.Disk
- `src/services/webdav.ts` — Yandex.Disk REST API client
- `src/services/markdown.ts` — Note generation
- `src/config.ts` — Config and types
- `src/utils/text-utils.ts` — URL detection utilities

</canonical_refs>

<specifics>
## Specific Ideas

- Reuse detectVideoUrl() already in text-utils.ts, extend URL patterns
- yt-dlp is already installed on VPS at /usr/local/bin/yt-dlp (or install if missing)
- ffmpeg is at /usr/bin/ffmpeg
- Processing is async and slow (minutes) — send progress updates via ctx.reply()
- Telegram file download limit 20MB via Bot API, use getFile for audio files sent by user
</specifics>

<deferred>
## Deferred Ideas

- Instagram support (unstable, consider Cobalt.tools API later)
- TikTok support
- Automatic language detection for transcription
- Video thumbnail extraction and embedding
- Batch processing of multiple URLs
</deferred>

---

*Phase: 04-media-pipeline*
*Context gathered: 2026-03-29 via conversation*
