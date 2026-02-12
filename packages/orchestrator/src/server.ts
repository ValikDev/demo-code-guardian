import { createApp } from './app.js'
import {
  DEFAULT_PORT,
  DEFAULT_QUEUE_MAX_CONCURRENT,
  DEFAULT_QUEUE_MAX_SIZE,
  DEFAULT_REGISTRY_MAX_ENTRIES,
  DEFAULT_REGISTRY_MAX_VULNS_PER_SCAN,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
} from './constants.js'
import { createJobQueue } from './services/job-queue.js'
import { createScanRegistry } from './services/scan-registry.js'
import { runJob, shutdownWorkers } from './services/worker-manager.js'

const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10)
const maxQueued = parseInt(process.env.QUEUE_MAX_SIZE ?? String(DEFAULT_QUEUE_MAX_SIZE), 10)
const maxConcurrent = parseInt(process.env.QUEUE_MAX_CONCURRENT ?? String(DEFAULT_QUEUE_MAX_CONCURRENT), 10)

// --- Composition root ---

const registry = createScanRegistry({
  maxEntries: DEFAULT_REGISTRY_MAX_ENTRIES,
  maxVulnsPerScan: DEFAULT_REGISTRY_MAX_VULNS_PER_SCAN,
})

const queue = createJobQueue({ maxQueued, maxConcurrent })

queue.setProcessor((job) => {
  runJob(job.scanId, job.repoUrl, { registry, queue })
})

const app = createApp({ registry, queue })

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

    shutdownWorkers().then(() => {
      console.log('All workers terminated')
      process.exit(0)
    }).catch(() => {
      process.exit(1)
    })
  })

  setTimeout(() => {
    console.error('Forced shutdown after timeout')
    process.exit(1)
  }, DEFAULT_SHUTDOWN_TIMEOUT_MS).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
