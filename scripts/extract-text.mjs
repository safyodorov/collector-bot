#!/usr/bin/env node
/**
 * Universal text extraction script.
 * Converts documents to markdown preserving structure.
 *
 * Usage: node extract-text.mjs <input-file>
 * Output: markdown text to stdout
 *
 * Supported: .pdf, .docx, .doc, .txt, .csv, .xlsx, .xls
 */

import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { extname } from 'path'

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node extract-text.mjs <input-file>')
  process.exit(1)
}

const ext = extname(inputPath).toLowerCase()

try {
  let result = ''

  switch (ext) {
    case '.pdf':
      result = extractPdf(inputPath)
      break
    case '.docx':
      result = await extractDocx(inputPath)
      break
    case '.doc':
      result = extractDoc(inputPath)
      break
    case '.txt':
    case '.md':
      result = readFileSync(inputPath, 'utf8')
      break
    case '.csv':
      result = csvToMarkdown(readFileSync(inputPath, 'utf8'))
      break
    case '.xlsx':
    case '.xls':
      result = await extractExcel(inputPath)
      break
    default:
      // Try reading as plain text
      result = readFileSync(inputPath, 'utf8')
  }

  process.stdout.write(result)
} catch (err) {
  console.error(`[extract-text] Error processing ${ext}: ${err.message}`)
  process.exit(1)
}

// --- PDF via pymupdf4llm ---
function extractPdf(path) {
  const script = `
import pymupdf4llm, sys, warnings, os
os.environ['ONNXRUNTIME_DISABLE_TELEMETRY'] = '1'
warnings.filterwarnings('ignore')
md = pymupdf4llm.to_markdown("${path.replace(/"/g, '\\"')}")
sys.stdout.write(md)
`
  return execSync(`python3 -c '${script.replace(/'/g, "'\\''")}'`, {
    timeout: 60000,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  }).toString('utf8')
}

// --- DOCX via mammoth → markdown ---
async function extractDocx(path) {
  const mammoth = await import('mammoth')
  const buffer = readFileSync(path)
  const result = await mammoth.convertToMarkdown({ buffer })
  return result.value
}

// --- DOC via antiword ---
function extractDoc(path) {
  return execSync(`antiword -m UTF-8 "${path}"`, {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  }).toString('utf8')
}

// --- CSV → markdown table ---
function csvToMarkdown(csv) {
  const lines = csv.trim().split('\n')
  if (lines.length === 0) return ''

  // Detect delimiter
  const firstLine = lines[0]
  const delim = firstLine.includes('\t') ? '\t'
    : firstLine.includes(';') ? ';'
    : ','

  const rows = lines.map(line => parseCsvLine(line, delim))
  if (rows.length === 0) return ''

  const header = rows[0]
  const mdLines = []
  mdLines.push('| ' + header.join(' | ') + ' |')
  mdLines.push('| ' + header.map(() => '---').join(' | ') + ' |')
  for (let i = 1; i < rows.length; i++) {
    // Pad row to header length
    while (rows[i].length < header.length) rows[i].push('')
    mdLines.push('| ' + rows[i].join(' | ') + ' |')
  }
  return mdLines.join('\n')
}

function parseCsvLine(line, delim) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delim) {
        cells.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  cells.push(current.trim())
  return cells
}

// --- Excel via xlsx → markdown tables ---
async function extractExcel(path) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.readFile(path)
  const sections = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (data.length === 0) continue

    const lines = []
    if (workbook.SheetNames.length > 1) {
      lines.push(`## ${sheetName}`)
      lines.push('')
    }

    const header = data[0].map(c => String(c))
    lines.push('| ' + header.join(' | ') + ' |')
    lines.push('| ' + header.map(() => '---').join(' | ') + ' |')
    for (let i = 1; i < data.length; i++) {
      const row = data[i].map(c => String(c ?? ''))
      while (row.length < header.length) row.push('')
      lines.push('| ' + row.join(' | ') + ' |')
    }

    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}
