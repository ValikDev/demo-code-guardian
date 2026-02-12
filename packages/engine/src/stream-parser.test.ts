import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { Vulnerability } from '@code-guardian/shared/types'
import type { ScanError } from '@code-guardian/shared/types'
import { parseTrivyStream } from './stream-parser.js'

async function withTempFile(
  content: string,
  fn: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cg-parse-test-'))
  const filePath = path.join(dir, 'trivy-results.json')
  await writeFile(filePath, content, 'utf-8')
  try {
    await fn(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function makeTrivyJson(results: unknown[]): string {
  return JSON.stringify({ Results: results })
}

const CRITICAL_VULN = {
  VulnerabilityID: 'CVE-2021-44228',
  PkgName: 'log4j-core',
  InstalledVersion: '2.14.1',
  FixedVersion: '2.17.0',
  Severity: 'CRITICAL',
  Title: 'Log4Shell',
  Description: 'Remote code execution via JNDI lookup',
}

const HIGH_VULN = {
  VulnerabilityID: 'CVE-2021-45046',
  PkgName: 'log4j-core',
  InstalledVersion: '2.14.1',
  FixedVersion: '2.17.0',
  Severity: 'HIGH',
  Title: 'Log4j followup',
  Description: 'Incomplete fix for CVE-2021-44228',
}

describe('parseTrivyStream', () => {
  it('extracts CRITICAL vulnerabilities from Trivy JSON', async () => {
    const json = makeTrivyJson([
      {
        Target: 'pom.xml',
        Vulnerabilities: [CRITICAL_VULN, HIGH_VULN],
      },
    ])

    const collected: Vulnerability[] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(filePath, (batch) => {
        collected.push(...batch)
      })
    })

    assert.equal(collected.length, 1)
    assert.equal(collected[0].id, 'CVE-2021-44228')
    assert.equal(collected[0].package, 'log4j-core')
    assert.equal(collected[0].severity, 'CRITICAL')
    assert.equal(collected[0].fixedVersion, '2.17.0')
  })

  it('handles multiple Results with mixed severities', async () => {
    const json = makeTrivyJson([
      {
        Target: 'package-lock.json',
        Vulnerabilities: [CRITICAL_VULN, HIGH_VULN],
      },
      {
        Target: 'Gemfile.lock',
        Vulnerabilities: [
          { ...CRITICAL_VULN, VulnerabilityID: 'CVE-2022-99999', PkgName: 'rails' },
        ],
      },
    ])

    const collected: Vulnerability[] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(filePath, (batch) => {
        collected.push(...batch)
      })
    })

    assert.equal(collected.length, 2)
    assert.equal(collected[0].id, 'CVE-2021-44228')
    assert.equal(collected[1].id, 'CVE-2022-99999')
    assert.equal(collected[1].package, 'rails')
  })

  it('returns empty when no CRITICAL vulns exist', async () => {
    const json = makeTrivyJson([
      {
        Target: 'go.sum',
        Vulnerabilities: [HIGH_VULN],
      },
    ])

    const collected: Vulnerability[] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(filePath, (batch) => {
        collected.push(...batch)
      })
    })

    assert.equal(collected.length, 0)
  })

  it('handles null Vulnerabilities array', async () => {
    const json = makeTrivyJson([
      { Target: 'Dockerfile', Vulnerabilities: null },
    ])

    const collected: Vulnerability[] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(filePath, (batch) => {
        collected.push(...batch)
      })
    })

    assert.equal(collected.length, 0)
  })

  it('handles empty Results array', async () => {
    const json = makeTrivyJson([])

    const collected: Vulnerability[] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(filePath, (batch) => {
        collected.push(...batch)
      })
    })

    assert.equal(collected.length, 0)
  })

  it('sends batches according to batchSize', async () => {
    const vulns = Array.from({ length: 7 }, (_, i) => ({
      ...CRITICAL_VULN,
      VulnerabilityID: `CVE-2021-${String(i).padStart(4, '0')}`,
    }))

    const json = makeTrivyJson([{ Target: 'test', Vulnerabilities: vulns }])

    const batches: Vulnerability[][] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(
        filePath,
        (batch) => { batches.push([...batch]) },
        { batchSize: 3 },
      )
    })

    // 7 vulns with batchSize 3: batches of [3, 3, 1]
    assert.equal(batches.length, 3)
    assert.equal(batches[0].length, 3)
    assert.equal(batches[1].length, 3)
    assert.equal(batches[2].length, 1)
  })

  it('throws PARSE_FAILED for nonexistent file', async () => {
    try {
      await parseTrivyStream('/nonexistent/trivy.json', () => { /* noop */ })
      assert.fail('Expected parseTrivyStream to throw')
    } catch (err) {
      const scanErr = err as ScanError
      assert.equal(scanErr.code, 'PARSE_FAILED')
    }
  })

  it('handles missing optional fields gracefully', async () => {
    const json = makeTrivyJson([
      {
        Target: 'test',
        Vulnerabilities: [
          { Severity: 'CRITICAL' },
        ],
      },
    ])

    const collected: Vulnerability[] = []

    await withTempFile(json, async (filePath) => {
      await parseTrivyStream(filePath, (batch) => {
        collected.push(...batch)
      })
    })

    assert.equal(collected.length, 1)
    assert.equal(collected[0].id, 'unknown')
    assert.equal(collected[0].package, 'unknown')
    assert.equal(collected[0].fixedVersion, null)
  })
})
