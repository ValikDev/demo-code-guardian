import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScanError } from '@code-guardian/shared/types'
import { runTrivy } from './trivy-scanner.js'

/**
 * Integration tests for the Trivy scanner.
 *
 * Prerequisites (tests FAIL if not met — do not skip):
 *   - `trivy` binary installed and on PATH
 *
 * Run via: pnpm test:integration
 */

describe('trivy-scanner (integration)', () => {
  it('produces a JSON output file for a directory with vulnerabilities', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cg-trivy-test-'))

    // Create a minimal project dir with a package.json that has a known vulnerability
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
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws TIMEOUT when scan exceeds timeout', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cg-trivy-timeout-'))

    try {
      await runTrivy(tmpDir, { timeoutMs: 1 })
      assert.fail('Expected runTrivy to throw')
    } catch (err) {
      const scanErr = err as ScanError
      assert.equal(scanErr.code, 'TIMEOUT')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
