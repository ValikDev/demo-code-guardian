import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createScanRegistry } from './scan-registry.js'
import { createJobQueue } from './job-queue.js'
import { runJob } from './worker-manager.js'

const MOCK_WORKER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/mock-worker.ts',
)

function createDeps() {
  const registry = createScanRegistry({ maxEntries: 50, maxVulnsPerScan: 10_000 })
  const queue = createJobQueue({ maxQueued: 10, maxConcurrent: 1 })
  return { registry, queue }
}

function waitForTerminal(
  deps: ReturnType<typeof createDeps>,
  scanId: string,
  timeoutMs = 5_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const record = deps.registry.get(scanId)
      if (record && (record.status === 'Finished' || record.status === 'Failed')) {
        clearInterval(interval)
        clearTimeout(timeout)
        resolve()
      }
    }, 50)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`Timed out waiting for scan ${scanId} to reach terminal state`))
    }, timeoutMs)
  })
}

describe('worker-manager (mock worker)', () => {
  it('completes a scan and receives vulnerabilities via IPC', async () => {
    const deps = createDeps()
    const scanId = 'test-success-1'
    deps.registry.create(scanId, 'https://github.com/owner/repo')

    runJob(scanId, 'https://github.com/owner/repo', deps, { workerModule: MOCK_WORKER })

    await waitForTerminal(deps, scanId)

    const record = deps.registry.get(scanId)
    assert.ok(record)
    assert.equal(record.status, 'Finished')
    assert.ok(Array.isArray(record.vulnerabilities))
    assert.equal(record.vulnerabilities.length, 1)
    assert.equal(record.vulnerabilities[0].id, 'CVE-2021-44228')
  })

  it('releases queue slot after job completes', async () => {
    const deps = createDeps()
    const scanId = 'test-queue-release'
    deps.registry.create(scanId, 'https://github.com/owner/repo')

    assert.equal(deps.queue.active, 0)

    runJob(scanId, 'https://github.com/owner/repo', deps, { workerModule: MOCK_WORKER })

    await waitForTerminal(deps, scanId)

    assert.equal(deps.queue.active, 0)
  })

  it('handles worker errors via IPC', async () => {
    const deps = createDeps()
    const scanId = 'test-error-1'
    deps.registry.create(scanId, 'https://github.com/owner/error-repo')

    runJob(scanId, 'https://github.com/owner/error-repo', deps, { workerModule: MOCK_WORKER })

    await waitForTerminal(deps, scanId)

    const record = deps.registry.get(scanId)
    assert.ok(record)
    assert.equal(record.status, 'Failed')
    assert.ok(record.error)
    assert.equal(record.error.code, 'CLONE_FAILED')
    assert.equal(record.error.message, 'mock clone failure')
    assert.equal(deps.queue.active, 0)
  })

  it('handles worker timeout gracefully', async () => {
    const deps = createDeps()
    const scanId = 'test-timeout-1'
    deps.registry.create(scanId, 'https://github.com/owner/hang-repo')

    // Mock worker will hang when repoUrl contains "hang"
    runJob(scanId, 'https://github.com/owner/hang-repo', deps, {
      workerModule: MOCK_WORKER,
      timeoutMs: 100,
    })

    await waitForTerminal(deps, scanId)

    const record = deps.registry.get(scanId)
    assert.ok(record)
    assert.equal(record.status, 'Failed')
    assert.ok(record.error)
    assert.equal(record.error.code, 'TIMEOUT')
    assert.equal(deps.queue.active, 0)
  })
})
