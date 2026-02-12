import { isOrchestratorMessage, type WorkerMessage } from '@code-guardian/shared/ipc-protocol'

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

async function processJob(scanId: string, _repoUrl: string): Promise<void> {
  try {
    send({ type: 'status', scanId, status: 'Scanning' })

    // TODO: replace with real pipeline: clone -> trivy -> stream-parse
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Dummy: send empty results and finish
    send({ type: 'vulns', scanId, vulnerabilities: [] })
    send({ type: 'status', scanId, status: 'Finished' })
  } catch (err) {
    send({
      type: 'error',
      scanId,
      error: {
        code: 'UNKNOWN',
        message: err instanceof Error ? err.message : String(err),
      },
    })
  } finally {
    // TODO: cleanup temp dirs here
    process.exit(0)
  }
}
