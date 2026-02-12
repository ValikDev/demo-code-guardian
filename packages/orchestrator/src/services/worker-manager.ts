import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isWorkerMessage } from '@code-guardian/shared/ipc-protocol'
import type { OrchestratorMessage } from '@code-guardian/shared/ipc-protocol'
import type { JobQueue } from './job-queue.js'
import type { ScanRegistry } from './scan-registry.js'
import {
  DEFAULT_WORKER_MAX_OLD_SPACE_SIZE,
  DEFAULT_WORKER_TIMEOUT_MS,
  DEFAULT_WORKER_SHUTDOWN_GRACE_MS,
} from '../constants.js'

export type WorkerManagerConfig = {
  maxOldSpaceSize?: number
  timeoutMs?: number
  /** Override worker module path (for testing with a mock worker). */
  workerModule?: string
}

export type WorkerManagerDeps = {
  registry: ScanRegistry
  queue: JobQueue
}

/**
 * Detect whether we're running from compiled JS (dist/) or TypeScript source (src/).
 * This determines the worker module path and whether tsx is needed.
 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isCompiledJs = __filename.endsWith('.js')

const WORKER_MODULE = isCompiledJs
  ? path.resolve(__dirname, '../../../engine/dist/worker.js')
  : path.resolve(__dirname, '../../../engine/src/worker.ts')

/** Active child processes, tracked for graceful shutdown. */
const activeWorkers = new Set<ChildProcess>()

export function runJob(
  scanId: string,
  repoUrl: string,
  deps: WorkerManagerDeps,
  config: WorkerManagerConfig = {},
): void {
  const { registry, queue } = deps
  const maxOldSpaceSize = config.maxOldSpaceSize ?? DEFAULT_WORKER_MAX_OLD_SPACE_SIZE
  const timeoutMs = config.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS
  const workerModule = config.workerModule ?? WORKER_MODULE

  let child: ChildProcess | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let settled = false

  function settle(): void {
    if (settled) return
    settled = true

    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }

    if (child) activeWorkers.delete(child)

    queue.onJobComplete()
  }

  try {
    child = fork(workerModule, {
      execArgv: [
        ...(isCompiledJs ? [] : ['--import', 'tsx']),
        `--max-old-space-size=${maxOldSpaceSize}`,
      ],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        // Allowlist only the variables the worker needs — avoid leaking
        // secrets (API keys, DB credentials, etc.) from the parent env.
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NODE_ENV: process.env.NODE_ENV,
        // Prevent NODE_OPTIONS from overriding the explicit execArgv flags
        NODE_OPTIONS: '',
      },
    })
  } catch (err) {
    registry.setError(scanId, {
      code: 'UNKNOWN',
      message: `Failed to fork worker: ${err instanceof Error ? err.message : String(err)}`,
    })
    settle()
    return
  }

  activeWorkers.add(child)

  // Timeout guard
  timeoutHandle = setTimeout(() => {
    if (settled) return
    registry.setError(scanId, {
      code: 'TIMEOUT',
      message: `Worker timed out after ${timeoutMs}ms`,
    })
    child?.kill('SIGKILL')
    settle()
  }, timeoutMs)
  timeoutHandle.unref()

  // Capture stderr for OOM detection
  let stderrChunks = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks += chunk.toString()
    // Cap captured stderr to avoid memory growth
    if (stderrChunks.length > 4096) {
      stderrChunks = stderrChunks.slice(-4096)
    }
  })

  // Handle IPC messages from worker
  child.on('message', (raw: unknown) => {
    if (settled || !isWorkerMessage(raw)) return
    if (raw.scanId !== scanId) return

    switch (raw.type) {
      case 'status':
        registry.updateStatus(scanId, raw.status)
        break
      case 'vulns':
        registry.appendVulnerabilities(scanId, raw.vulnerabilities)
        break
      case 'error':
        registry.setError(scanId, raw.error)
        break
    }
  })

  // Handle worker exit
  child.on('exit', (code, signal) => {
    if (settled) return

    const record = registry.get(scanId)
    const isTerminal = record?.status === 'Finished' || record?.status === 'Failed'

    if (!isTerminal) {
      // V8 heap exhaustion writes to stderr before aborting (SIGABRT).
      // SIGKILL without stderr evidence typically comes from the container
      // cgroup OOM killer, which is a distinct but related scenario.
      const v8Oom = stderrChunks.includes('JavaScript heap out of memory')
        || stderrChunks.includes('FATAL ERROR')
      const cgroupOom = signal === 'SIGKILL' && !v8Oom

      const code_ = v8Oom || cgroupOom ? 'OOM' : 'UNKNOWN'
      const message = v8Oom
        ? 'Worker ran out of memory (V8 heap limit exceeded)'
        : cgroupOom
          ? 'Worker was killed by the OS (likely container OOM killer)'
          : `Worker exited unexpectedly (code=${code}, signal=${signal})`

      registry.setError(scanId, { code: code_, message })
    }

    settle()
  })

  // Handle fork errors (e.g. ENOENT)
  child.on('error', (err) => {
    if (settled) return
    registry.setError(scanId, {
      code: 'UNKNOWN',
      message: `Worker process error: ${err.message}`,
    })
    settle()
  })

  // Send start message
  const startMsg: OrchestratorMessage = {
    type: 'start',
    payload: { scanId, repoUrl },
  }
  child.send(startMsg)
}

/**
 * Gracefully shut down all active workers.
 * Sends SIGTERM first, then SIGKILL after a grace period.
 * Resolves once every worker has exited.
 */
export function shutdownWorkers(
  graceMs: number = DEFAULT_WORKER_SHUTDOWN_GRACE_MS,
): Promise<void> {
  if (activeWorkers.size === 0) return Promise.resolve()

  return new Promise((resolve) => {
    const workers = [...activeWorkers]
    let remaining = workers.length

    function onExit(): void {
      remaining--
      if (remaining <= 0) resolve()
    }

    for (const w of workers) {
      w.once('exit', onExit)
      w.kill('SIGTERM')
    }

    // Force-kill any stragglers after the grace period
    setTimeout(() => {
      for (const w of workers) {
        if (w.exitCode === null && w.signalCode === null) {
          w.kill('SIGKILL')
        }
      }
    }, graceMs).unref()
  })
}
