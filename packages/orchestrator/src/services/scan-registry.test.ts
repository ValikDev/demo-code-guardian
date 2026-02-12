import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Vulnerability } from '@code-guardian/shared/types'
import { createScanRegistry } from './scan-registry.js'

const makeCriticalVuln = (id: string): Vulnerability => ({
  id,
  package: 'test-pkg',
  installedVersion: '1.0.0',
  fixedVersion: '2.0.0',
  severity: 'CRITICAL',
  title: `Vuln ${id}`,
  description: `Description for ${id}`,
})

describe('createScanRegistry', () => {
  describe('create', () => {
    it('creates a scan record with Queued status', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      const record = registry.create('scan-1', 'https://github.com/owner/repo')

      assert.equal(record.scanId, 'scan-1')
      assert.equal(record.repoUrl, 'https://github.com/owner/repo')
      assert.equal(record.status, 'Queued')
      assert.deepEqual(record.vulnerabilities, [])
      assert.equal(record.truncated, false)
      assert.equal(record.error, null)
    })

    it('is retrievable via get', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      registry.create('scan-1', 'https://github.com/owner/repo')

      const record = registry.get('scan-1')
      assert.ok(record)
      assert.equal(record.scanId, 'scan-1')
    })
  })

  describe('get', () => {
    it('returns undefined for unknown scanId', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      assert.equal(registry.get('nonexistent'), undefined)
    })
  })

  describe('updateStatus', () => {
    it('updates status and updatedAt', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      const record = registry.create('scan-1', 'https://github.com/owner/repo')
      const originalUpdatedAt = record.updatedAt

      // Small delay to ensure timestamp differs
      registry.updateStatus('scan-1', 'Scanning')

      assert.equal(record.status, 'Scanning')
      assert.ok(record.updatedAt >= originalUpdatedAt)
    })

    it('is a no-op for unknown scanId', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      registry.updateStatus('nonexistent', 'Scanning') // should not throw
    })
  })

  describe('setError', () => {
    it('sets error and marks status as Failed', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      registry.create('scan-1', 'https://github.com/owner/repo')

      registry.setError('scan-1', { code: 'TRIVY_FAILED', message: 'trivy crashed' })

      const record = registry.get('scan-1')
      assert.ok(record)
      assert.equal(record.status, 'Failed')
      assert.deepEqual(record.error, { code: 'TRIVY_FAILED', message: 'trivy crashed' })
    })
  })

  describe('appendVulnerabilities', () => {
    it('appends vulnerabilities to record', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      registry.create('scan-1', 'https://github.com/owner/repo')

      const vulns = [makeCriticalVuln('CVE-1'), makeCriticalVuln('CVE-2')]
      registry.appendVulnerabilities('scan-1', vulns)

      const record = registry.get('scan-1')
      assert.ok(record)
      assert.equal(record.vulnerabilities.length, 2)
      assert.equal(record.truncated, false)
    })

    it('caps at maxVulnsPerScan and sets truncated flag', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 3 })
      registry.create('scan-1', 'https://github.com/owner/repo')

      registry.appendVulnerabilities('scan-1', [
        makeCriticalVuln('CVE-1'),
        makeCriticalVuln('CVE-2'),
      ])
      registry.appendVulnerabilities('scan-1', [
        makeCriticalVuln('CVE-3'),
        makeCriticalVuln('CVE-4'),
        makeCriticalVuln('CVE-5'),
      ])

      const record = registry.get('scan-1')
      assert.ok(record)
      assert.equal(record.vulnerabilities.length, 3)
      assert.equal(record.truncated, true)
    })

    it('sets truncated when already at cap', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 1 })
      registry.create('scan-1', 'https://github.com/owner/repo')

      registry.appendVulnerabilities('scan-1', [makeCriticalVuln('CVE-1')])
      registry.appendVulnerabilities('scan-1', [makeCriticalVuln('CVE-2')])

      const record = registry.get('scan-1')
      assert.ok(record)
      assert.equal(record.vulnerabilities.length, 1)
      assert.equal(record.truncated, true)
    })
  })

  describe('eviction', () => {
    it('evicts oldest Finished/Failed entries when over maxEntries', () => {
      const registry = createScanRegistry({ maxEntries: 2, maxVulnsPerScan: 100 })

      registry.create('scan-1', 'https://github.com/owner/repo1')
      registry.updateStatus('scan-1', 'Scanning')
      registry.updateStatus('scan-1', 'Finished')

      registry.create('scan-2', 'https://github.com/owner/repo2')
      registry.updateStatus('scan-2', 'Scanning')
      registry.updateStatus('scan-2', 'Finished')

      // This should trigger eviction of scan-1
      registry.create('scan-3', 'https://github.com/owner/repo3')

      assert.equal(registry.get('scan-1'), undefined)
      assert.ok(registry.get('scan-2'))
      assert.ok(registry.get('scan-3'))
      assert.equal(registry.size, 2)
    })

    it('prefers evicting Finished/Failed over active scans', () => {
      const registry = createScanRegistry({ maxEntries: 2, maxVulnsPerScan: 100 })

      registry.create('scan-1', 'https://github.com/owner/repo1')
      registry.updateStatus('scan-1', 'Scanning') // active

      registry.create('scan-2', 'https://github.com/owner/repo2')
      registry.updateStatus('scan-2', 'Scanning')
      registry.updateStatus('scan-2', 'Finished') // terminal

      // Should evict scan-2 (Finished) not scan-1 (Scanning)
      registry.create('scan-3', 'https://github.com/owner/repo3')

      assert.ok(registry.get('scan-1'))
      assert.equal(registry.get('scan-2'), undefined)
      assert.ok(registry.get('scan-3'))
    })

    it('evicts oldest entries regardless of status when no terminal entries exist', () => {
      const registry = createScanRegistry({ maxEntries: 2, maxVulnsPerScan: 100 })

      registry.create('scan-1', 'https://github.com/owner/repo1')
      registry.updateStatus('scan-1', 'Scanning')

      registry.create('scan-2', 'https://github.com/owner/repo2')
      registry.updateStatus('scan-2', 'Scanning')

      // No Finished/Failed to evict, so oldest (scan-1) gets evicted
      registry.create('scan-3', 'https://github.com/owner/repo3')

      assert.equal(registry.get('scan-1'), undefined)
      assert.ok(registry.get('scan-2'))
      assert.ok(registry.get('scan-3'))
    })
  })

  describe('size', () => {
    it('tracks number of entries', () => {
      const registry = createScanRegistry({ maxEntries: 10, maxVulnsPerScan: 100 })
      assert.equal(registry.size, 0)

      registry.create('scan-1', 'https://github.com/owner/repo1')
      assert.equal(registry.size, 1)

      registry.create('scan-2', 'https://github.com/owner/repo2')
      assert.equal(registry.size, 2)
    })
  })
})
