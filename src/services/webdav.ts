import { readFileSync } from 'node:fs'
import { YANDEX_DISK_TOKEN, OBSIDIAN_VAULT_PATH } from '../config.js'

const API_BASE = 'https://cloud-api.yandex.net/v1/disk'

// In-memory cache of created directories to avoid redundant calls
const dirCache = new Set<string>()

function authHeaders(): Record<string, string> {
  return { 'Authorization': `OAuth ${YANDEX_DISK_TOKEN}` }
}

export class WebDAVError extends Error {
  status: number
  method: string
  path: string

  constructor(method: string, path: string, status: number, message: string) {
    super(`YaDisk ${method} ${path}: ${status} ${message}`)
    this.name = 'WebDAVError'
    this.status = status
    this.method = method
    this.path = path
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504)
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation()
      if (result instanceof Response && isRetryable(result.status) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        console.log(`[YADISK] Retry ${attempt}/${maxRetries} after ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return result
    } catch (err) {
      if (err instanceof TypeError && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        console.log(`[YADISK] Retry ${attempt}/${maxRetries} after ${delay}ms (network error)`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  return operation()
}

/**
 * Upload a file via Yandex Disk REST API (two-step: get upload URL, then PUT)
 */
export async function putFile(
  path: string,
  content: BodyInit,
  contentType = 'text/markdown; charset=utf-8'
): Promise<void> {
  // Step 1: Get upload URL
  const diskPath = `disk:${path}`
  const urlRes = await withRetry(() =>
    fetch(`${API_BASE}/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`, {
      method: 'GET',
      headers: authHeaders(),
    })
  )

  if (!urlRes.ok) {
    throw new WebDAVError('GET_UPLOAD_URL', path, urlRes.status, urlRes.statusText)
  }

  const { href } = await urlRes.json() as { href: string }

  // Step 2: PUT file content to the upload URL
  const putRes = await withRetry(() =>
    fetch(href, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: content,
    })
  )

  if (putRes.status === 201 || putRes.status === 202 || putRes.status === 200) return
  throw new WebDAVError('PUT', path, putRes.status, putRes.statusText)
}

/**
 * Create a directory on Yandex Disk (recursive: creates parents automatically)
 */
export async function ensureDir(path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  let current = ''

  for (const segment of segments) {
    current += '/' + segment
    if (dirCache.has(current)) continue

    const diskPath = `disk:${current}`
    const res = await fetch(`${API_BASE}/resources?path=${encodeURIComponent(diskPath)}`, {
      method: 'PUT',
      headers: authHeaders(),
    })

    if (res.status === 201) {
      // Created
      dirCache.add(current)
    } else if (res.status === 409) {
      // Already exists
      dirCache.add(current)
    } else if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
      throw new WebDAVError('MKDIR', current, res.status, res.statusText)
    } else {
      // Other status — might be ok, cache it
      dirCache.add(current)
    }
  }
}

/**
 * Check if a resource exists at the given path
 */
export async function exists(path: string): Promise<boolean> {
  const diskPath = `disk:${path}`
  const res = await withRetry(() =>
    fetch(`${API_BASE}/resources?path=${encodeURIComponent(diskPath)}`, {
      method: 'GET',
      headers: authHeaders(),
    })
  )

  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new WebDAVError('EXISTS', path, res.status, res.statusText)
}

/**
 * Get file content (download via REST API)
 */
export async function getFile(path: string): Promise<string | null> {
  const diskPath = `disk:${path}`
  const res = await withRetry(() =>
    fetch(`${API_BASE}/resources/download?path=${encodeURIComponent(diskPath)}`, {
      method: 'GET',
      headers: authHeaders(),
    })
  )

  if (res.status === 404) return null
  if (!res.ok) throw new WebDAVError('GET_DOWNLOAD', path, res.status, res.statusText)

  const { href } = await res.json() as { href: string }
  const dlRes = await fetch(href)
  if (dlRes.ok) return dlRes.text()
  return null
}

/**
 * Verify that the Yandex Disk token is valid
 */
export async function initWebDAV(): Promise<void> {
  const res = await fetch(`${API_BASE}/`, {
    headers: authHeaders(),
  })

  if (res.status === 401) {
    throw new Error('Yandex Disk auth failed: invalid or expired YANDEX_DISK_TOKEN')
  }
  if (res.ok) {
    console.log('[YADISK] Authentication verified')
    return
  }
  throw new WebDAVError('INIT', '/', res.status, res.statusText)
}

/**
 * Upload a local file to Yandex Disk at the given remote path.
 * Reuses the existing REST API putFile() under the hood.
 */
export async function uploadToYandexDisk(
  localPath: string,
  remotePath: string,
): Promise<void> {
  const content = readFileSync(localPath)
  const contentType = remotePath.endsWith('.md')
    ? 'text/markdown; charset=utf-8'
    : 'application/octet-stream'

  await putFile(remotePath, new Uint8Array(content), contentType)
  console.log(`[YADISK] Uploaded: ${localPath} -> ${remotePath}`)
}

/**
 * Upload an Obsidian note and its transcript to Yandex.Disk.
 * Ensures the vault directory and attachments subdirectory exist.
 */
export async function uploadObsidianNote(
  notePath: string,
  transcriptPath: string,
  noteFilename: string,
  transcriptFilename: string,
): Promise<void> {
  // Ensure vault dir exists
  await ensureDir(OBSIDIAN_VAULT_PATH)
  // Ensure attachments subdir for transcripts
  await ensureDir(`${OBSIDIAN_VAULT_PATH}/attachments`)

  // Upload note to vault root
  await uploadToYandexDisk(notePath, `${OBSIDIAN_VAULT_PATH}/${noteFilename}`)
  // Upload transcript to attachments
  await uploadToYandexDisk(transcriptPath, `${OBSIDIAN_VAULT_PATH}/attachments/${transcriptFilename}`)

  console.log(`[YADISK] Obsidian note uploaded: ${noteFilename} + ${transcriptFilename}`)
}
