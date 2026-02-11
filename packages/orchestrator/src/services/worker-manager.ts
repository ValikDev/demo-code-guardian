import type { JobQueue } from './job-queue.js'
import type { ScanRegistry } from './scan-registry.js'

export type WorkerManagerDeps = {
  registry: ScanRegistry
  queue: JobQueue
}

/**
 * Dummy worker: immediately sets status to Scanning,
 * then Finished after a short delay.
 * TODO: replace with fork()-based process isolation.
 */
export function runJob(
  scanId: string,
  _repoUrl: string,
  deps: WorkerManagerDeps,
): void {
  const { registry, queue } = deps

  registry.updateStatus(scanId, 'Scanning')

  setTimeout(() => {
    registry.updateStatus(scanId, 'Finished')
    queue.onJobComplete()
  }, 100)
}
