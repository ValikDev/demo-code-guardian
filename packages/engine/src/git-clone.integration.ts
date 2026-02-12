import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ScanError } from '@code-guardian/shared/types'
import { cloneRepo } from './git-clone.js'

/**
 * Integration tests for git clone.
 *
 * Prerequisites (tests FAIL if not met — do not skip):
 *   - `git` binary installed and on PATH
 *   - Network access to github.com
 *
 * Run via: pnpm test:integration
 */

describe('cloneRepo (integration)', () => {
  it('clones a public repo into a temp directory', async () => {
    const result = await cloneRepo('https://github.com/octocat/Hello-World', {
      timeoutMs: 30_000,
    })

    try {
      // Verify directory exists and contains .git
      const stats = await stat(path.join(result.repoDir, '.git'))
      assert.ok(stats.isDirectory(), '.git should be a directory')
    } finally {
      await result.cleanup()
    }

    // Verify cleanup removed the directory
    assert.ok(!existsSync(result.repoDir), 'temp dir should be removed after cleanup')
  })

  it('throws CLONE_FAILED for an invalid repo URL', async () => {
    try {
      await cloneRepo('https://github.com/nonexistent-user-xxxxx/no-such-repo-yyyyy', {
        timeoutMs: 30_000,
      })
      assert.fail('Expected cloneRepo to throw')
    } catch (err) {
      const scanErr = err as ScanError
      assert.equal(scanErr.code, 'CLONE_FAILED')
      assert.ok(scanErr.message.length > 0)
    }
  })

  it('throws TIMEOUT when clone exceeds timeout', async () => {
    try {
      // 1ms timeout should always trigger
      await cloneRepo('https://github.com/torvalds/linux', {
        timeoutMs: 1,
      })
      assert.fail('Expected cloneRepo to throw')
    } catch (err) {
      const scanErr = err as ScanError
      assert.equal(scanErr.code, 'TIMEOUT')
    }
  })
})
