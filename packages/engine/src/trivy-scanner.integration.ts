import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScanError } from '@code-guardian/shared/types'
import { runTrivy } from './trivy-scanner.js'

let trivyAvailable = false

before(() => {
  return new Promise<void>((resolve) => {
    execFile('trivy', ['--version'], (err) => {
      trivyAvailable = !err
      resolve()
    })
  })
})

describe('trivy-scanner', () => {
  it('produces a JSON output file for a real repo dir (requires trivy)', async (t) => {
    if (!trivyAvailable) {
      t.skip('trivy not installed')
      return
    }

    // Create a minimal project dir with a package.json that has a known vulnerability
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cg-trivy-test-'))
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', dependencies: { lodash: '4.17.20' } }),
    )
    // Create node_modules stub so trivy has something to scan
    await mkdir(path.join(tmpDir, 'node_modules', 'lodash'), { recursive: true })
    await writeFile(
      path.join(tmpDir, 'node_modules', 'lodash', 'package.json'),
      JSON.stringify({ name: 'lodash', version: '4.17.20' }),
    )

    const result = await runTrivy(tmpDir, { timeoutMs: 60_000 })

    try {
      assert.ok(result.outputPath.endsWith('trivy-results.json'))
    } finally {
      await result.cleanup()
      const { rm } = await import('node:fs/promises')
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws TRIVY_FAILED when trivy is not found (mocked via invalid binary)', async (t) => {
    if (trivyAvailable) {
      // This test only makes sense when trivy is NOT available,
      // but we can still verify the error shape by using an impossible dir
      t.skip('trivy is installed; skipping not-found test')
      return
    }

    try {
      await runTrivy('/nonexistent-dir', { timeoutMs: 5_000 })
      assert.fail('Expected runTrivy to throw')
    } catch (err) {
      const scanErr = err as ScanError
      assert.equal(scanErr.code, 'TRIVY_FAILED')
      assert.ok(scanErr.message.length > 0)
    }
  })

  it('throws TIMEOUT when scan exceeds timeout (requires trivy)', async (t) => {
    if (!trivyAvailable) {
      t.skip('trivy not installed')
      return
    }

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cg-trivy-timeout-'))

    try {
      await runTrivy(tmpDir, { timeoutMs: 1 })
      assert.fail('Expected runTrivy to throw')
    } catch (err) {
      const scanErr = err as ScanError
      assert.equal(scanErr.code, 'TIMEOUT')
    } finally {
      const { rm } = await import('node:fs/promises')
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
