import type { ScanRecord } from '@code-guardian/shared/types'
import type { JobQueue } from './job-queue.js'

export type WorkerManagerDeps = {
  scans: Map<string, ScanRecord>
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
  const { scans, queue } = deps
  const scan = scans.get(scanId)

  if (!scan) {
    queue.onJobComplete()
    return
  }

  scan.status = 'Scanning'
  scan.updatedAt = new Date()

  setTimeout(() => {
    const current = scans.get(scanId)
    if (current) {
      current.status = 'Finished'
      current.updatedAt = new Date()
    }
    queue.onJobComplete()
  }, 100)
}
