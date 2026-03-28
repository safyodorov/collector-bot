import { YANDEX_DISK_TOKEN, WEBDAV_URL } from '../config.js'

// In-memory cache of created directories to avoid redundant MKCOL calls
const dirCache = new Set<string>()

function authHeaders(): Record<string, string> {
  return { 'Authorization': `OAuth ${YANDEX_DISK_TOKEN}` }
}

export function encodePath(path: string): string {
  return path.split('/').map(s => s ? encodeURIComponent(s) : '').join('/')
}

export class WebDAVError extends Error {
  status: number
  method: string
  path: string

  constructor(method: string, path: string, status: number, message: string) {
    super(`WebDAV ${method} ${path}: ${status} ${message}`)
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
        console.log(`[WEBDAV] Retry ${attempt}/${maxRetries} after ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return result
    } catch (err) {
      if (err instanceof TypeError && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        console.log(`[WEBDAV] Retry ${attempt}/${maxRetries} after ${delay}ms (network error)`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  // Final attempt — return as-is
  return operation()
}

export async function putFile(
  path: string,
  content: BodyInit,
  contentType = 'text/markdown; charset=utf-8'
): Promise<void> {
  const url = `${WEBDAV_URL}${encodePath(path)}`
  const res = await withRetry(() =>
    fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': contentType },
      body: content,
    })
  )

  if (res.status === 201 || res.status === 204) return

  if (res.status === 202) {
    // Async processing — poll until file appears
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (await exists(path)) return
    }
    throw new WebDAVError('PUT', path, 202, 'file not available after 30s polling')
  }

  throw new WebDAVError('PUT', path, res.status, res.statusText)
}

export async function ensureDir(path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  let current = ''

  for (const segment of segments) {
    current += '/' + segment
    if (dirCache.has(current)) continue

    const url = `${WEBDAV_URL}${encodePath(current)}`
    const res = await fetch(url, {
      method: 'MKCOL',
      headers: authHeaders(),
    })

    if (res.status === 201 || res.status === 405) {
      // 201 = created, 405 = already exists
      dirCache.add(current)
    } else if (res.status === 409) {
      throw new WebDAVError('MKCOL', current, 409, 'parent directory missing')
    } else {
      throw new WebDAVError('MKCOL', current, res.status, res.statusText)
    }
  }
}

export async function exists(path: string): Promise<boolean> {
  const url = `${WEBDAV_URL}${encodePath(path)}`
  const res = await withRetry(() =>
    fetch(url, {
      method: 'PROPFIND',
      headers: { ...authHeaders(), 'Depth': '0' },
    })
  )

  if (res.status === 207) return true
  if (res.status === 404) return false
  throw new WebDAVError('PROPFIND', path, res.status, res.statusText)
}

export async function getFile(path: string): Promise<string | null> {
  const url = `${WEBDAV_URL}${encodePath(path)}`
  const res = await withRetry(() =>
    fetch(url, {
      method: 'GET',
      headers: authHeaders(),
    })
  )

  if (res.status === 200) return res.text()
  if (res.status === 404) return null
  throw new WebDAVError('GET', path, res.status, res.statusText)
}

export async function initWebDAV(): Promise<void> {
  const url = `${WEBDAV_URL}/`
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { ...authHeaders(), 'Depth': '0' },
  })

  if (res.status === 401) {
    throw new Error('WebDAV auth failed: invalid or expired YANDEX_DISK_TOKEN')
  }
  if (res.status === 207) {
    console.log('[WEBDAV] Authentication verified')
    return
  }
  throw new WebDAVError('PROPFIND', '/', res.status, res.statusText)
}
