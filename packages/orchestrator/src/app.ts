import express, { type Express } from 'express'
import { createHandler } from 'graphql-http/lib/use/express'
import type { JobQueue } from './services/job-queue.js'
import type { ScanRegistry } from './services/scan-registry.js'
import { createScanController } from './controllers/scan.controller.js'
import { validateUrl } from './middleware/validate-url.js'
import { schema } from './graphql/schema.js'

export type AppContext = {
  registry: ScanRegistry
  queue: JobQueue
}

export function createApp(ctx: AppContext): Express {
  const app = express()

  app.use(express.json())

  // REST API
  const scan = createScanController(ctx)
  app.post('/api/scan', validateUrl, scan.startScan)
  app.get('/api/scan/:scanId', scan.getScan)

  // GraphQL API (POST-only — mutations must not be reachable via GET)
  app.post('/graphql', createHandler({
    schema,
    context: () => ctx,
  }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
