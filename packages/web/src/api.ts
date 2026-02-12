export type ScanStatus = 'Queued' | 'Scanning' | 'Finished' | 'Failed'

export type Vulnerability = {
  id: string
  package: string
  installedVersion: string
  fixedVersion: string | null
  severity: 'CRITICAL'
  title: string
  description: string
}

export type ScanError = {
  code: string
  message: string
}

export type ScanResponse = {
  scanId: string
  repoUrl: string
  status: ScanStatus
  vulnerabilities: Vulnerability[]
  truncated: boolean
  error: ScanError | null
  createdAt: string
  updatedAt: string
}

export type StartScanResponse = {
  scanId: string
  status: ScanStatus
}

export async function startScan(repoUrl: string): Promise<StartScanResponse> {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  })

  if (!res.ok) {
    const message = await extractErrorMessage(res)
    throw new Error(message)
  }

  return res.json() as Promise<StartScanResponse>
}

export async function getScan(scanId: string): Promise<ScanResponse> {
  const res = await fetch(`/api/scan/${scanId}`)

  if (!res.ok) {
    const message = await extractErrorMessage(res)
    throw new Error(message)
  }

  return res.json() as Promise<ScanResponse>
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status} ${res.statusText}`
  }
}
