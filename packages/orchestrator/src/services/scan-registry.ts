import type { ScanError, ScanRecord, ScanStatus, Vulnerability } from '@code-guardian/shared/types'

export type ScanRegistryConfig = {
  maxEntries: number
  maxVulnsPerScan: number
}

export function createScanRegistry(config: ScanRegistryConfig) {
  const scans = new Map<string, ScanRecord>()

  function evictIfNeeded(): void {
    if (scans.size < config.maxEntries) return

    // Evict oldest Finished/Failed entries first (Map preserves insertion order)
    for (const [id, record] of scans) {
      if (record.status === 'Finished' || record.status === 'Failed') {
        scans.delete(id)
        if (scans.size < config.maxEntries) return
      }
    }

    // If still at limit, evict oldest regardless of status
    for (const [id] of scans) {
      scans.delete(id)
      if (scans.size < config.maxEntries) return
    }
  }

  return {
    create(scanId: string, repoUrl: string): ScanRecord {
      evictIfNeeded()

      const now = new Date()
      const record: ScanRecord = {
        scanId,
        repoUrl,
        status: 'Queued',
        vulnerabilities: [],
        truncated: false,
        error: null,
        createdAt: now,
        updatedAt: now,
      }

      scans.set(scanId, record)
      return record
    },

    get(scanId: string): ScanRecord | undefined {
      return scans.get(scanId)
    },

    updateStatus(scanId: string, status: ScanStatus): void {
      const record = scans.get(scanId)
      if (!record) return
      record.status = status
      record.updatedAt = new Date()
    },

    appendVulnerabilities(scanId: string, vulns: Vulnerability[]): void {
      const record = scans.get(scanId)
      if (!record) return

      const remaining = config.maxVulnsPerScan - record.vulnerabilities.length
      if (remaining <= 0) {
        record.truncated = true
        return
      }

      if (vulns.length > remaining) {
        record.vulnerabilities.push(...vulns.slice(0, remaining))
        record.truncated = true
      } else {
        record.vulnerabilities.push(...vulns)
      }

      record.updatedAt = new Date()
    },

    setError(scanId: string, error: ScanError): void {
      const record = scans.get(scanId)
      if (!record) return
      record.error = error
      record.status = 'Failed'
      record.updatedAt = new Date()
    },

    get size(): number {
      return scans.size
    },
  }
}

export type ScanRegistry = ReturnType<typeof createScanRegistry>
