import type { ScanRecord } from '@code-guardian/shared/types'
import { createApp } from './app.js'
import {
  DEFAULT_PORT,
  DEFAULT_QUEUE_MAX_CONCURRENT,
  DEFAULT_QUEUE_MAX_SIZE,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
} from './constants.js'
import { createJobQueue } from './services/job-queue.js'
import { runJob } from './services/worker-manager.js'

const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10)
const maxQueued = parseInt(process.env.QUEUE_MAX_SIZE ?? String(DEFAULT_QUEUE_MAX_SIZE), 10)
const maxConcurrent = parseInt(process.env.QUEUE_MAX_CONCURRENT ?? String(DEFAULT_QUEUE_MAX_CONCURRENT), 10)

// --- Composition root ---

const scans = new Map<string, ScanRecord>()

const queue = createJobQueue({ maxQueued, maxConcurrent })

queue.setProcessor((job) => {
  runJob(job.scanId, job.repoUrl, { scans, queue })
})

const app = createApp({ scans, queue })

// --- Start server ---

const server = app.listen(port, () => {
  console.log(`Code Guardian listening on port ${port}`)
  console.log(`Queue: max ${maxQueued} queued, ${maxConcurrent} concurrent`)
})

// --- Graceful shutdown ---

function shutdown(signal: string): void {
  console.log(`\nReceived ${signal}, shutting down...`)
  server.close(() => {
    console.log('HTTP server closed')
    process.exit(0)
  })

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout')
    process.exit(1)
  }, DEFAULT_SHUTDOWN_TIMEOUT_MS).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
