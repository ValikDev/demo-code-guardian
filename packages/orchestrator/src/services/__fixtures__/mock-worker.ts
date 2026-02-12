/**
 * Mock worker for unit tests.
 *
 * Speaks the same IPC protocol as the real engine worker but does
 * no network calls, git clones, or trivy scans.
 *
 * Behaviour is controlled by the repoUrl in the start message:
 *   - contains "error"   → sends an IPC error message
 *   - contains "hang"    → never responds (simulates hung worker)
 *   - otherwise          → sends Scanning → vulns batch → Finished
 */
import { isOrchestratorMessage, type WorkerMessage } from '@code-guardian/shared/ipc-protocol'

function send(msg: WorkerMessage): void {
  if (process.send) {
    process.send(msg)
  }
}

process.on('message', (raw: unknown) => {
  if (!isOrchestratorMessage(raw)) return

  const { scanId, repoUrl } = raw.payload

  if (repoUrl.includes('hang')) {
    // Do nothing — simulate a hung worker for timeout tests
    return
  }

  if (repoUrl.includes('error')) {
    send({
      type: 'error',
      scanId,
      error: { code: 'CLONE_FAILED', message: 'mock clone failure' },
    })
    process.exit(0)
    return
  }

  // Happy path: Scanning → vulns → Finished
  send({ type: 'status', scanId, status: 'Scanning' })

  send({
    type: 'vulns',
    scanId,
    vulnerabilities: [
      {
        id: 'CVE-2021-44228',
        package: 'log4j-core',
        installedVersion: '2.14.1',
        fixedVersion: '2.17.0',
        severity: 'CRITICAL',
        title: 'Log4Shell',
        description: 'Mock vulnerability for testing',
      },
    ],
  })

  send({ type: 'status', scanId, status: 'Finished' })
  process.exit(0)
})
