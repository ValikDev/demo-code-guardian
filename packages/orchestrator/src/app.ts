import express, { type Express } from 'express'
import type { ScanRecord } from '@code-guardian/shared/types'
import type { JobQueue } from './services/job-queue.js'
import { createScanController } from './controllers/scan.controller.js'
import { validateUrl } from './middleware/validate-url.js'

export type AppContext = {
  scans: Map<string, ScanRecord>
  queue: JobQueue
}

export function createApp(ctx: AppContext): Express {
  const app = express()

  app.use(express.json())

  const scan = createScanController(ctx)

  app.post('/api/scan', validateUrl, scan.startScan)
  app.get('/api/scan/:scanId', scan.getScan)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
