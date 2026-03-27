/** Split text into chunks of max `size` characters, breaking at line boundaries */
export function splitText(text: string, size = 2000): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= size) {
      chunks.push(remaining)
      break
    }
    // Try to break at newline
    let breakAt = remaining.lastIndexOf('\n', size)
    if (breakAt < size * 0.3) breakAt = remaining.lastIndexOf(' ', size)
    if (breakAt < size * 0.3) breakAt = size
    chunks.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }
  return chunks
}

/** Auto-generate title from text */
export function autoTitle(text: string, maxLen = 60): string {
  const firstLine = text.split('\n')[0]?.trim() || text.trim()
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen - 3) + '...'
}

/** Detect video URL in text */
const VIDEO_PATTERNS = [
  /youtube\.com\/watch\?v=/i,
  /youtu\.be\//i,
  /youtube\.com\/shorts\//i,
  /vk\.com\/video/i,
  /vk\.com\/clip/i,
  /rutube\.ru\/video\//i,
  /dzen\.ru\/video\/watch\//i,
  /ok\.ru\/video\//i,
]

export function detectVideoUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/\S+/g)
  if (!urlMatch) return null
  for (const url of urlMatch) {
    for (const pattern of VIDEO_PATTERNS) {
      if (pattern.test(url)) return url
    }
  }
  return null
}
