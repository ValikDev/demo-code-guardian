import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import makeParser from 'stream-json'
import Pick from 'stream-json/filters/Pick.js'
import StreamArray from 'stream-json/streamers/StreamArray.js'
import type { Vulnerability } from '@code-guardian/shared/types'
import type { ScanError } from '@code-guardian/shared/types'
import { VULN_BATCH_SIZE } from './constants.js'

/**
 * Trivy vulnerability object shape (relevant fields only).
 * Trivy uses PascalCase keys in JSON output.
 */
type TrivyVuln = {
  VulnerabilityID?: string
  PkgName?: string
  InstalledVersion?: string
  FixedVersion?: string
  Severity?: string
  Title?: string
  Description?: string
}

/**
 * Trivy Result object shape.
 * Each Result has a Target and a Vulnerabilities array.
 */
type TrivyResult = {
  Target?: string
  Vulnerabilities?: TrivyVuln[] | null
}

export type ParseOptions = {
  batchSize?: number
}

/**
 * Stream-parse a Trivy JSON output file, extracting only CRITICAL vulnerabilities.
 * Calls `onBatch` with small batches to avoid holding all vulns in memory.
 *
 * The Trivy JSON structure is:
 *   { "Results": [ { "Target": "...", "Vulnerabilities": [ ... ] } ] }
 *
 * We stream into Results array items, then iterate each item's Vulnerabilities
 * in-memory (each Result object is small -- it's the array of Results that can be huge).
 */
export async function parseTrivyStream(
  filePath: string,
  onBatch: (vulns: Vulnerability[]) => void,
  options: ParseOptions = {},
): Promise<void> {
  const batchSize = options.batchSize ?? VULN_BATCH_SIZE
  let batch: Vulnerability[] = []

  function flush(): void {
    if (batch.length > 0) {
      onBatch(batch)
      batch = []
    }
  }

  function pushVuln(vuln: Vulnerability): void {
    batch.push(vuln)
    if (batch.length >= batchSize) {
      flush()
    }
  }

  const processer = new Transform({
    objectMode: true,
    transform(chunk: { key: number; value: TrivyResult }, _encoding, callback) {
      const result = chunk.value
      const vulns = result.Vulnerabilities

      if (Array.isArray(vulns)) {
        for (const v of vulns) {
          if (v.Severity !== 'CRITICAL') continue

          pushVuln({
            id: v.VulnerabilityID ?? 'unknown',
            package: v.PkgName ?? 'unknown',
            installedVersion: v.InstalledVersion ?? 'unknown',
            fixedVersion: v.FixedVersion ?? null,
            severity: 'CRITICAL',
            title: v.Title ?? '',
            description: v.Description ?? '',
          })
        }
      }

      callback()
    },
    flush(callback) {
      flush()
      callback()
    },
  })

  try {
    await pipeline(
      createReadStream(filePath, { highWaterMark: 64 * 1024 }),
      makeParser(),
      Pick.pick({ filter: 'Results' }),
      StreamArray.streamArray(),
      processer,
    )
  } catch (err) {
    throw toParseError(err)
  }
}

function toParseError(err: unknown): ScanError {
  const message = err instanceof Error ? err.message : String(err)

  if (message.includes('ENOENT') || message.includes('no such file')) {
    return { code: 'PARSE_FAILED', message: `Trivy output file not found: ${message}` }
  }

  return { code: 'PARSE_FAILED', message: `Failed to parse Trivy output: ${message}` }
}
