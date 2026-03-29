---
phase: 04-media-pipeline
plan: 01
subsystem: media
tags: [yt-dlp, deepgram, nova-3, transcription, audio-download]

requires:
  - phase: 01-webdav-foundation
    provides: config.ts pattern, project structure
provides:
  - "Config exports for media pipeline (DEEPGRAM, OPENAI, TEMP_DIR, etc.)"
  - "yt-dlp wrapper: getVideoInfo, downloadAudio, extractVideoUrl"
  - "Deepgram transcriber: transcribeAudio with speaker labels and timecodes"
affects: [04-02, 04-03]

tech-stack:
  added: ["@deepgram/sdk v5"]
  patterns: ["execFile async wrapper for CLI tools", "retry with attempt counter"]

key-files:
  created:
    - src/services/downloader.ts
    - src/services/transcriber.ts
  modified:
    - src/config.ts

key-decisions:
  - "DeepgramClient constructor uses {apiKey} option in SDK v5"
  - "SDK v5 API path: client.listen.v1.media.transcribeFile(stream, options)"
  - "No logger module exists in project; used console.log/warn instead"
  - "PROJECT_ROOT added to config.ts for TEMP_DIR resolution"

patterns-established:
  - "CLI tool wrapping: promisify(execFile) with timeout and error wrapping"
  - "Retry pattern: for-loop with attempt counter, warn on first failure"

requirements-completed: [MP-01, MP-02, MP-03]

duration: 5min
completed: 2026-03-29
---

# Phase 04 Plan 01: Media Pipeline Foundation Summary

**yt-dlp audio downloader and Deepgram Nova-3 transcriber services with config env vars for media pipeline**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-29T08:26:20Z
- **Completed:** 2026-03-29T08:31:16Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Extended config.ts with 9 new env var exports (Deepgram, OpenAI, Obsidian, temp dir)
- Created downloader service wrapping yt-dlp for video info retrieval and audio extraction
- Created transcriber service using Deepgram Nova-3 with diarization, speaker labels, and timecodes

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend config.ts with media pipeline env vars** - `88a0778` (feat)
2. **Task 2: Create downloader service (yt-dlp wrapper)** - `6d7261e` (feat)
3. **Task 3: Create transcriber service (Deepgram Nova-3)** - `c68204b` (feat)

## Files Created/Modified
- `src/config.ts` - Added DEEPGRAM_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL, SUMMARY_MODEL, MAX_DURATION_SECONDS, OBSIDIAN_VAULT_PATH, YANDEX_WEBDAV_LOGIN/PASSWORD, PROJECT_ROOT, TEMP_DIR
- `src/services/downloader.ts` - yt-dlp wrapper: getVideoInfo, downloadAudio, extractVideoUrl, formatDuration, DownloadError, DurationError
- `src/services/transcriber.ts` - Deepgram Nova-3 transcription: transcribeAudio returning text with speaker labels and timecodes

## Decisions Made
- Used `{apiKey}` constructor option for DeepgramClient v5 (not `{key}`)
- SDK v5 transcription path is `client.listen.v1.media.transcribeFile()` (not `client.listen.prerecorded`)
- Used `createReadStream` instead of `readFileSync` for file upload (SDK expects Uploadable/stream)
- Added `PROJECT_ROOT` export to config.ts (needed by TEMP_DIR, was missing)
- Used `console.log`/`console.warn` instead of a logger module (project has no logger)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] No logger module in project**
- **Found during:** Task 2 (downloader service)
- **Issue:** Plan specified `import { logger } from '../logger.js'` but no logger module exists
- **Fix:** Used `console.log` and `console.warn` instead
- **Files modified:** src/services/downloader.ts, src/services/transcriber.ts
- **Verification:** tsc --noEmit passes

**2. [Rule 3 - Blocking] PROJECT_ROOT not defined in config.ts**
- **Found during:** Task 1 (config extension)
- **Issue:** TEMP_DIR depends on PROJECT_ROOT but it wasn't exported
- **Fix:** Added `export const PROJECT_ROOT = resolve(__dirname, '..')`
- **Files modified:** src/config.ts
- **Verification:** tsc --noEmit passes

**3. [Rule 1 - Bug] Deepgram SDK v5 API differences**
- **Found during:** Task 3 (transcriber service)
- **Issue:** Plan referenced `createClient` (v3/v4 API) and `listen.prerecorded.transcribeFile` -- SDK v5 uses `DeepgramClient` class and `listen.v1.media.transcribeFile`
- **Fix:** Adapted to SDK v5 API: `new DeepgramClient({apiKey})`, `client.listen.v1.media.transcribeFile(stream, opts)`
- **Files modified:** src/services/transcriber.ts
- **Verification:** tsc --noEmit passes

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All fixes necessary for compilation. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - DEEPGRAM_API_KEY already in .env on VPS.

## Next Phase Readiness
- Config, downloader, and transcriber services ready for plan 04-02 (pipeline handler)
- All services compile cleanly and export documented APIs

## Self-Check: PASSED

All 3 created files verified on disk. All 3 task commits verified in git log.

---
*Phase: 04-media-pipeline*
*Completed: 2026-03-29*
