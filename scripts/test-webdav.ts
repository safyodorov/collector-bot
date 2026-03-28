import { initWebDAV, putFile, exists, getFile } from '../src/services/webdav.js'
import { initVault } from '../src/services/vault.js'
import { VAULT_PATH } from '../src/config.js'

let passed = 0
let failed = 0
const total = 8

async function test(step: number, description: string, fn: () => Promise<void>): Promise<void> {
  console.log(`[TEST] Step ${step}: ${description}...`)
  try {
    await fn()
    console.log(`[PASS] ${description}`)
    passed++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[FAIL] ${description}: ${msg}`)
    failed++
  }
}

async function main() {
  const ts = Date.now()
  const textPath = `${VAULT_PATH}/Inbox/тест_${ts}.md`
  const textContent = 'Привет, мир! Тестовая заметка.'
  const binaryPath = `${VAULT_PATH}/attachments/test_${ts}.jpg`
  const binaryContent = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])

  // Step 1: Auth check
  await test(1, 'Auth check (initWebDAV)', async () => {
    await initWebDAV()
  })

  // Step 2: Create vault structure
  await test(2, 'Create vault structure (initVault)', async () => {
    await initVault()
  })

  // Step 3: Idempotency check
  await test(3, 'Idempotency check (initVault again)', async () => {
    await initVault()
  })

  // Step 4: Upload text file with Cyrillic name
  await test(4, 'Upload text file with Cyrillic name', async () => {
    await putFile(textPath, textContent, 'text/markdown; charset=utf-8')
    console.log(`  Uploaded: ${textPath}`)
  })

  // Step 5: Check file exists
  await test(5, 'Check file exists / non-existent returns false', async () => {
    const found = await exists(textPath)
    if (!found) throw new Error(`Expected ${textPath} to exist`)
    const notFound = await exists(`${VAULT_PATH}/Inbox/несуществующий_${ts}.md`)
    if (notFound) throw new Error('Expected non-existent file to return false')
  })

  // Step 6: Read file back
  await test(6, 'Read file back and verify content', async () => {
    const content = await getFile(textPath)
    if (content !== textContent) {
      throw new Error(`Content mismatch: expected "${textContent}", got "${content}"`)
    }
  })

  // Step 7: Upload binary file
  await test(7, 'Upload binary file (JFIF header)', async () => {
    await putFile(binaryPath, binaryContent, 'image/jpeg')
    console.log(`  Uploaded: ${binaryPath}`)
  })

  // Step 8: Verify binary exists
  await test(8, 'Verify binary file exists', async () => {
    const found = await exists(binaryPath)
    if (!found) throw new Error(`Expected ${binaryPath} to exist`)
  })

  console.log(`\n[RESULT] ${passed}/${total} tests passed`)
  if (failed > 0) {
    console.log(`[RESULT] ${failed} tests FAILED`)
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
