import { createHash } from 'node:crypto'

export function contentHash(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

export function urlNormalize(url: string): string {
  try {
    const u = new URL(url)
    // Remove tracking params
    const removeParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'si', 'feature']
    removeParams.forEach(p => u.searchParams.delete(p))
    // Force https
    u.protocol = 'https:'
    // Remove trailing slash
    let path = u.pathname.replace(/\/+$/, '') || '/'
    return u.origin + path + (u.search || '')
  } catch {
    return url
  }
}
