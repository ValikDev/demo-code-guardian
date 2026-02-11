import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import type { ScanRecord } from '@code-guardian/shared/types'
import type { JobQueue } from '../services/job-queue.js'

export type ScanControllerDeps = {
  scans: Map<string, ScanRecord>
  queue: JobQueue
}

export function createScanController(deps: ScanControllerDeps) {
  const { scans, queue } = deps

  return {
    startScan(req: Request, res: Response): void {
      const { repoUrl } = req.body as { repoUrl: string }

      const scanId = randomUUID()
      const now = new Date()

      const record: ScanRecord = {
        scanId,
        repoUrl,
        status: 'Queued',
        vulnerabilities: [],
        truncated: false,
        error: null,
        createdAt: now,
        updatedAt: now,
      }

      scans.set(scanId, record)

      const enqueued = queue.enqueue({ scanId, repoUrl })
      if (!enqueued) {
        scans.delete(scanId)
        res.status(429).json({
          error: 'Queue is full. Try again later.',
          retryAfter: 30,
        })
        return
      }

      // Return Queued status regardless of how fast the processor picks it up
      res.status(202).json({
        scanId,
        status: 'Queued' as const,
      })
    },

    getScan(req: Request<{ scanId: string }>, res: Response): void {
      const { scanId } = req.params
      const record = scans.get(scanId)

      if (!record) {
        res.status(404).json({ error: 'Scan not found' })
        return
      }

      res.status(200).json({
        scanId: record.scanId,
        repoUrl: record.repoUrl,
        status: record.status,
        vulnerabilities: record.status === 'Finished' ? record.vulnerabilities : undefined,
        truncated: record.status === 'Finished' ? record.truncated : undefined,
        error: record.status === 'Failed' ? record.error : undefined,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      })
    },
  }
}
