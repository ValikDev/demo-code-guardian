import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { ScanError } from '@code-guardian/shared/types'
import { DEFAULT_TRIVY_TIMEOUT_MS, EXEC_MAX_BUFFER, TRIVY_OUTPUT_FILENAME } from './constants.js'

export type TrivyResult = {
  outputPath: string
  cleanup: () => Promise<void>
}

export type TrivyOptions = {
  timeoutMs?: number
}

/**
 * Run Trivy filesystem scan on a cloned repo directory.
 * Outputs results as JSON to a file inside the repo dir.
 * Returns the path to the JSON file and a cleanup function.
 */
export async function runTrivy(
  repoDir: string,
  options: TrivyOptions = {},
): Promise<TrivyResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRIVY_TIMEOUT_MS
  const outputPath = path.join(repoDir, TRIVY_OUTPUT_FILENAME)

  async function cleanup(): Promise<void> {
    try {
      await rm(outputPath, { force: true })
    } catch {
      // Best-effort cleanup
    }
  }

  try {
    await execTrivy([
      'fs',
      '--format', 'json',
      '--output', outputPath,
      '--severity', 'CRITICAL',
      '--scanners', 'vuln',
      '--quiet',
      repoDir,
    ], timeoutMs)
  } catch (err) {
    await cleanup()
    throw toTrivyError(err)
  }

  return { outputPath, cleanup }
}

function execTrivy(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('trivy', args, {
      timeout: timeoutMs,
      maxBuffer: EXEC_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        const combined = `${stderr}\n${error.message}`.trim()
        reject(new TrivyExecError(combined, error.killed ?? false))
        return
      }
      resolve(stdout)
    })
  })
}

class TrivyExecError extends Error {
  readonly killed: boolean
  constructor(message: string, killed: boolean) {
    super(message)
    this.name = 'TrivyExecError'
    this.killed = killed
  }
}

function toTrivyError(err: unknown): ScanError {
  if (err instanceof TrivyExecError) {
    if (err.killed) {
      return { code: 'TIMEOUT', message: `Trivy scan timed out: ${err.message}` }
    }

    const msg = err.message.toLowerCase()

    if (msg.includes('no space left on device') || msg.includes('disk quota exceeded')) {
      return { code: 'DISK_FULL', message: `Disk full during scan: ${err.message}` }
    }

    if (msg.includes('not found') || msg.includes('enoent')) {
      return { code: 'TRIVY_FAILED', message: `Trivy not found. Is it installed? ${err.message}` }
    }

    return { code: 'TRIVY_FAILED', message: err.message }
  }

  return {
    code: 'TRIVY_FAILED',
    message: err instanceof Error ? err.message : String(err),
  }
}
