import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScanError } from '@code-guardian/shared/types'
import { DEFAULT_CLONE_TIMEOUT_MS, TEMP_PREFIX } from './constants.js'

export type CloneResult = {
  repoDir: string
  cleanup: () => Promise<void>
}

export type CloneOptions = {
  timeoutMs?: number
}

export async function cloneRepo(
  repoUrl: string,
  options: CloneOptions = {},
): Promise<CloneResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS

  const tmpBase = path.join(os.tmpdir(), TEMP_PREFIX)
  const repoDir = await mkdtemp(tmpBase)

  async function cleanup(): Promise<void> {
    try {
      await rm(repoDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup; temp dir will be cleaned up by OS eventually
    }
  }

  try {
    await execGit([
      'clone',
      '--depth', '1',
      '--single-branch',
      '--no-tags',
      repoUrl,
      repoDir,
    ], timeoutMs)
  } catch (err) {
    await cleanup()
    throw toCloneError(err)
  }

  return { repoDir, cleanup }
}

function execGit(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        // Disable interactive prompts (e.g. for credentials)
        GIT_TERMINAL_PROMPT: '0',
      },
    }, (error, stdout, stderr) => {
      if (error) {
        const combined = `${stderr}\n${error.message}`.trim()
        reject(new GitError(combined, error.killed ?? false))
        return
      }
      resolve(stdout)
    })
  })
}

class GitError extends Error {
  readonly killed: boolean
  constructor(message: string, killed: boolean) {
    super(message)
    this.name = 'GitError'
    this.killed = killed
  }
}

function toCloneError(err: unknown): ScanError {
  if (err instanceof GitError) {
    if (err.killed) {
      return { code: 'TIMEOUT', message: `Git clone timed out: ${err.message}` }
    }

    const msg = err.message.toLowerCase()

    if (msg.includes('no space left on device') || msg.includes('disk quota exceeded')) {
      return { code: 'DISK_FULL', message: `Disk full during clone: ${err.message}` }
    }

    return { code: 'CLONE_FAILED', message: err.message }
  }

  return {
    code: 'CLONE_FAILED',
    message: err instanceof Error ? err.message : String(err),
  }
}
