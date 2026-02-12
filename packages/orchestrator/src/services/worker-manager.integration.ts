import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createScanRegistry } from './scan-registry.js'
import { createJobQueue } from './job-queue.js'
import { runJob } from './worker-manager.js'

function createDeps() {
  const registry = createScanRegistry({ maxEntries: 50, maxVulnsPerScan: 10_000 })
  const queue = createJobQueue({ maxQueued: 10, maxConcurrent: 1 })
  return { registry, queue }
}

function waitForTerminal(
  deps: ReturnType<typeof createDeps>,
  scanId: string,
  timeoutMs = 10_000,
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

describe('worker-manager (fork-based)', () => {
  it('runs a dummy job to completion via forked worker', async () => {
    const deps = createDeps()
    const scanId = 'test-success-1'
    deps.registry.create(scanId, 'https://github.com/OWASP/NodeGoat')

    runJob(scanId, 'https://github.com/OWASP/NodeGoat', deps)

    await waitForTerminal(deps, scanId)

    const record = deps.registry.get(scanId)
    assert.ok(record)
    assert.equal(record.status, 'Finished')
    assert.ok(Array.isArray(record.vulnerabilities))
    assert.equal(deps.queue.active, 0)
  })

  it('releases queue slot after job completes', async () => {
    const deps = createDeps()
    const scanId = 'test-queue-release'
    deps.registry.create(scanId, 'https://github.com/owner/repo')

    assert.equal(deps.queue.active, 0)

    runJob(scanId, 'https://github.com/owner/repo', deps)

    await waitForTerminal(deps, scanId)

    assert.equal(deps.queue.active, 0)
  })

  it('handles worker timeout gracefully', async () => {
    const deps = createDeps()
    const scanId = 'test-timeout-1'
    deps.registry.create(scanId, 'https://github.com/owner/repo')

    // Use very short timeout (worker takes at least 50ms)
    runJob(scanId, 'https://github.com/owner/repo', deps, { timeoutMs: 1 })

    await waitForTerminal(deps, scanId)

    const record = deps.registry.get(scanId)
    assert.ok(record)
    assert.equal(record.status, 'Failed')
    assert.ok(record.error)
    assert.equal(record.error.code, 'TIMEOUT')
    assert.equal(deps.queue.active, 0)
  })
})
