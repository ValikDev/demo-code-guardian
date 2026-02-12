import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { DEFAULT_RETRY_AFTER_SECONDS } from '../constants.js'
import type { JobQueue } from '../services/job-queue.js'
import type { ScanRegistry } from '../services/scan-registry.js'

export type ScanControllerDeps = {
  registry: ScanRegistry
  queue: JobQueue
}

export function createScanController(deps: ScanControllerDeps) {
  const { registry, queue } = deps

  return {
    startScan(req: Request, res: Response): void {
      const { repoUrl } = req.body as { repoUrl: string }

      const scanId = randomUUID()
      registry.create(scanId, repoUrl)

      const enqueued = queue.enqueue({ scanId, repoUrl })
      if (!enqueued) {
        registry.setError(scanId, {
          code: 'UNKNOWN',
          message: 'Queue is full',
        })
        res.status(429).json({
          error: 'Queue is full. Try again later.',
          retryAfter: DEFAULT_RETRY_AFTER_SECONDS,
        })
        return
      }

      res.status(202).json({
        scanId,
        status: 'Queued' as const,
      })
    },

    getScan(req: Request<{ scanId: string }>, res: Response): void {
      const { scanId } = req.params
      const record = registry.get(scanId)

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
