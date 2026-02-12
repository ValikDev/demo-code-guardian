import { isOrchestratorMessage, type WorkerMessage } from '@code-guardian/shared/ipc-protocol'
import type { ScanError } from '@code-guardian/shared/types'
import { cloneRepo, type CloneResult } from './git-clone.js'
import { runTrivy, type TrivyResult } from './trivy-scanner.js'

function send(msg: WorkerMessage): void {
  if (process.send) {
    process.send(msg)
  }
}

process.on('message', (raw: unknown) => {
  if (!isOrchestratorMessage(raw)) return

  const { scanId, repoUrl } = raw.payload

  void processJob(scanId, repoUrl)
})

async function processJob(scanId: string, repoUrl: string): Promise<void> {
  let cloneResult: CloneResult | null = null
  let trivyResult: TrivyResult | null = null

  try {
    send({ type: 'status', scanId, status: 'Scanning' })

    // Step 1: Clone
    cloneResult = await cloneRepo(repoUrl)

    // Step 2: Run Trivy
    trivyResult = await runTrivy(cloneResult.repoDir)

    // TODO: Step 3: Stream-parse trivyResult.outputPath

    // Dummy: send empty results and finish
    send({ type: 'vulns', scanId, vulnerabilities: [] })
    send({ type: 'status', scanId, status: 'Finished' })
  } catch (err) {
    const scanError = isScanError(err)
      ? err
      : { code: 'UNKNOWN' as const, message: err instanceof Error ? err.message : String(err) }

    send({ type: 'error', scanId, error: scanError })
  } finally {
    if (trivyResult) {
      await trivyResult.cleanup()
    }
    if (cloneResult) {
      await cloneResult.cleanup()
    }
    process.exit(0)
  }
}

function isScanError(err: unknown): err is ScanError {
  if (typeof err !== 'object' || err === null) return false
  const obj = err as Record<string, unknown>
  return typeof obj.code === 'string' && typeof obj.message === 'string'
}
