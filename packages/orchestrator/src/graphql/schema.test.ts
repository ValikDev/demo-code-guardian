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

type GqlResponse = {
  data?: {
    startScan?: {
      scan: { scanId: string; status: string } | null
      error: { message: string } | null
    }
    scan?: Record<string, unknown> | null
  }
  errors?: { message: string }[]
}

async function gql(baseUrl: string, query: string, variables: Record<string, unknown> = {}): Promise<GqlResponse> {
  const res = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  return res.json() as Promise<GqlResponse>
}

const START_SCAN = `
  mutation StartScan($repoUrl: String!) {
    startScan(repoUrl: $repoUrl) {
      scan { scanId status }
      error { message }
    }
  }
`

const GET_SCAN = `
  query GetScan($id: String!) {
    scan(id: $id) {
      id repoUrl status truncated
      criticalVulnerabilities { id package severity }
      error { code message }
      createdAt updatedAt
    }
  }
`

describe('GraphQL startScan mutation', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = setupTestServer()
  })

  afterEach(() => {
    ctx.server.close()
  })

  it('returns scan with Queued status for valid GitHub URL', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://github.com/OWASP/NodeGoat' })

    assert.ok(body.data?.startScan?.scan)
    assert.equal(body.data.startScan.scan.status, 'Queued')
    assert.equal(typeof body.data.startScan.scan.scanId, 'string')
    assert.equal(body.data.startScan.error, null)
  })

  it('returns error for non-GitHub URL', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://gitlab.com/user/repo' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /GitHub/)
  })

  it('returns error for HTTP (non-HTTPS) URL', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'http://github.com/owner/repo' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /HTTPS/)
  })

  it('returns error for invalid URL format', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'not-a-url' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /Invalid URL/)
  })

  it('returns error for GitHub URL without owner/repo path', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://github.com/' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /repository/)
  })

  it('returns error for file:// protocol (SSRF attempt)', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'file:///etc/passwd' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /HTTPS/)
  })

  it('returns error for internal network URL (SSRF attempt)', async () => {
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://internal.corp/owner/repo' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /GitHub/)
  })

  it('returns error when queue is full', async () => {
    ctx.server.close()
    ctx = setupTestServer({ maxQueued: 1, maxConcurrent: 0 })

    // Fill the queue
    await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://github.com/owner/repo1' })

    // This should be rejected
    const body = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://github.com/owner/repo2' })

    assert.equal(body.data?.startScan?.scan, null)
    assert.ok(body.data?.startScan?.error)
    assert.match(body.data.startScan.error.message, /Queue is full/)
  })

  it('does not create a registry entry for invalid URLs', async () => {
    await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://evil.com/owner/repo' })
    assert.equal(ctx.registry.size, 0)
  })
})

describe('GraphQL scan query', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = setupTestServer()
  })

  afterEach(() => {
    ctx.server.close()
  })

  it('returns null for unknown scan ID', async () => {
    const body = await gql(ctx.baseUrl, GET_SCAN, { id: 'nonexistent-id' })
    assert.equal(body.data?.scan, null)
  })

  it('returns scan data after creation via mutation', async () => {
    const createBody = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://github.com/OWASP/NodeGoat' })
    const scanId = createBody.data?.startScan?.scan?.scanId
    assert.ok(scanId)

    const body = await gql(ctx.baseUrl, GET_SCAN, { id: scanId })

    assert.ok(body.data?.scan)
    assert.equal(body.data.scan.repoUrl, 'https://github.com/OWASP/NodeGoat')
    assert.equal(typeof body.data.scan.createdAt, 'string')
    assert.equal(typeof body.data.scan.updatedAt, 'string')
  })

  it('returns Finished status with vulnerabilities after processing', async () => {
    const createBody = await gql(ctx.baseUrl, START_SCAN, { repoUrl: 'https://github.com/OWASP/NodeGoat' })
    const scanId = createBody.data?.startScan?.scan?.scanId
    assert.ok(scanId)

    // Wait for dummy processor to finish
    await new Promise((resolve) => setTimeout(resolve, 50))

    const body = await gql(ctx.baseUrl, GET_SCAN, { id: scanId })

    assert.ok(body.data?.scan)
    assert.equal(body.data.scan.status, 'Finished')
    assert.ok(Array.isArray(body.data.scan.criticalVulnerabilities))
    assert.equal(body.data.scan.truncated, false)
  })
})
