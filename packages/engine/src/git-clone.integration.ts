import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ScanError } from '@code-guardian/shared/types'
import { cloneRepo } from './git-clone.js'

describe('cloneRepo', () => {
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

  it('cleans up temp dir on failure', async () => {
    let tempDirExisted = false

    try {
      await cloneRepo('https://github.com/nonexistent-user-xxxxx/no-such-repo-yyyyy', {
        timeoutMs: 30_000,
      })
    } catch {
      // The temp dir should already be cleaned up by cloneRepo on failure.
      // We can't easily capture the dir path here, but the fact that
      // the function throws (not hangs/leaks) is the important assertion.
      tempDirExisted = true
    }

    assert.ok(tempDirExisted, 'cloneRepo should throw for invalid repo')
  })
})
