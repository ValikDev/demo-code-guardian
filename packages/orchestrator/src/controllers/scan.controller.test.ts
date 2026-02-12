import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.js'
import { createJobQueue } from '../services/job-queue.js'
import { createScanRegistry } from '../services/scan-registry.js'

type TestContext = {
  server: Server
  baseUrl: string
  registry: ReturnType<typeof createScanRegistry>
  queue: ReturnType<typeof createJobQueue>
}

function setupTestServer(queueConfig = { maxQueued: 10, maxConcurrent: 1 }): TestContext {
  const registry = createScanRegistry({ maxEntries: 50, maxVulnsPerScan: 10_000 })
  const queue = createJobQueue(queueConfig)

  // Dummy processor: updates via registry
  queue.setProcessor((job) => {
    registry.updateStatus(job.scanId, 'Scanning')
    setTimeout(() => {
      registry.updateStatus(job.scanId, 'Finished')
      queue.onJobComplete()
    }, 10)
  })

  const app = createApp({ registry, queue })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://localhost:${port}`

  return { server, baseUrl, registry, queue }
}

describe('POST /api/scan', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = setupTestServer()
  })

  afterEach(() => {
    ctx.server.close()
  })

  it('returns 202 with scanId and Queued status for valid GitHub URL', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/OWASP/NodeGoat' }),
    })

    assert.equal(res.status, 202)
    const body = await res.json() as Record<string, unknown>
    assert.equal(typeof body.scanId, 'string')
    assert.equal(body.status, 'Queued')
  })

  it('returns 400 when repoUrl is missing', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    assert.equal(res.status, 400)
    const body = await res.json() as Record<string, unknown>
    assert.equal(typeof body.error, 'string')
  })

  it('returns 400 for non-GitHub URL', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://gitlab.com/user/repo' }),
    })

    assert.equal(res.status, 400)
  })

  it('returns 400 for invalid URL format', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'not-a-url' }),
    })

    assert.equal(res.status, 400)
  })

  it('returns 400 for GitHub URL without owner/repo path', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/' }),
    })

    assert.equal(res.status, 400)
  })

  it('returns 429 when queue is full', async () => {
    ctx.server.close()
    ctx = setupTestServer({ maxQueued: 1, maxConcurrent: 0 })

    // Fill the queue
    await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/owner/repo1' }),
    })

    // This should be rejected
    const res = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/owner/repo2' }),
    })

    assert.equal(res.status, 429)
    const body = await res.json() as Record<string, unknown>
    assert.equal(typeof body.retryAfter, 'number')
  })
})

describe('GET /api/scan/:scanId', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = setupTestServer()
  })

  afterEach(() => {
    ctx.server.close()
  })

  it('returns 404 for unknown scanId', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/scan/nonexistent-id`)
    assert.equal(res.status, 404)
  })

  it('returns 200 with scan data for existing scan', async () => {
    const createRes = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/OWASP/NodeGoat' }),
    })
    const { scanId } = await createRes.json() as { scanId: string }

    const res = await fetch(`${ctx.baseUrl}/api/scan/${scanId}`)
    assert.equal(res.status, 200)

    const body = await res.json() as Record<string, unknown>
    assert.equal(body.scanId, scanId)
    assert.equal(typeof body.status, 'string')
    assert.equal(body.repoUrl, 'https://github.com/OWASP/NodeGoat')
    assert.equal(typeof body.createdAt, 'string')
    assert.equal(typeof body.updatedAt, 'string')
  })

  it('returns Finished status with vulnerabilities after processing', async () => {
    const createRes = await fetch(`${ctx.baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/OWASP/NodeGoat' }),
    })
    const { scanId } = await createRes.json() as { scanId: string }

    // Wait for dummy worker to finish
    await new Promise((resolve) => setTimeout(resolve, 50))

    const res = await fetch(`${ctx.baseUrl}/api/scan/${scanId}`)
    const body = await res.json() as Record<string, unknown>

    assert.equal(body.status, 'Finished')
    assert.ok(Array.isArray(body.vulnerabilities))
  })
})

describe('GET /health', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = setupTestServer()
  })

  afterEach(() => {
    ctx.server.close()
  })

  it('returns 200 with ok status', async () => {
    const res = await fetch(`${ctx.baseUrl}/health`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.status, 'ok')
  })
})
