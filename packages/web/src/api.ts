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

// --- REST API ---

export async function startScanRest(repoUrl: string): Promise<StartScanResponse> {
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

export async function getScanRest(scanId: string): Promise<ScanResponse> {
  const res = await fetch(`/api/scan/${scanId}`)

  if (!res.ok) {
    const message = await extractErrorMessage(res)
    throw new Error(message)
  }

  return res.json() as Promise<ScanResponse>
}

// --- GraphQL API ---

async function gqlRequest<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    const message = await extractErrorMessage(res)
    throw new Error(message)
  }

  const body = await res.json() as { data?: T; errors?: { message: string }[] }

  if (body.errors?.length) {
    throw new Error(body.errors[0].message)
  }

  if (!body.data) {
    throw new Error('No data returned from GraphQL')
  }

  return body.data
}

const START_SCAN_MUTATION = `
  mutation StartScan($repoUrl: String!) {
    startScan(repoUrl: $repoUrl) {
      scan { scanId status }
      error { message }
    }
  }
`

type StartScanGqlData = {
  startScan: {
    scan: { scanId: string; status: ScanStatus } | null
    error: { message: string } | null
  }
}

export async function startScanGraphql(repoUrl: string): Promise<StartScanResponse> {
  const data = await gqlRequest<StartScanGqlData>(START_SCAN_MUTATION, { repoUrl })

  if (data.startScan.error) {
    throw new Error(data.startScan.error.message)
  }

  if (!data.startScan.scan) {
    throw new Error('No scan returned')
  }

  return data.startScan.scan
}

const GET_SCAN_QUERY = `
  query GetScan($id: String!) {
    scan(id: $id) {
      id repoUrl status truncated
      criticalVulnerabilities {
        id package installedVersion fixedVersion severity title description
      }
      error { code message }
      createdAt updatedAt
    }
  }
`

type GetScanGqlData = {
  scan: {
    id: string
    repoUrl: string
    status: ScanStatus
    criticalVulnerabilities: Vulnerability[]
    truncated: boolean
    error: ScanError | null
    createdAt: string
    updatedAt: string
  } | null
}

export async function getScanGraphql(scanId: string): Promise<ScanResponse> {
  const data = await gqlRequest<GetScanGqlData>(GET_SCAN_QUERY, { id: scanId })

  if (!data.scan) {
    throw new Error('Scan not found')
  }

  return {
    scanId: data.scan.id,
    repoUrl: data.scan.repoUrl,
    status: data.scan.status,
    vulnerabilities: data.scan.criticalVulnerabilities,
    truncated: data.scan.truncated,
    error: data.scan.error,
    createdAt: data.scan.createdAt,
    updatedAt: data.scan.updatedAt,
  }
}

// --- Unified interface ---

export type ApiMode = 'rest' | 'graphql'

export function startScan(repoUrl: string, mode: ApiMode): Promise<StartScanResponse> {
  return mode === 'graphql' ? startScanGraphql(repoUrl) : startScanRest(repoUrl)
}

export function getScan(scanId: string, mode: ApiMode): Promise<ScanResponse> {
  return mode === 'graphql' ? getScanGraphql(scanId) : getScanRest(scanId)
}

// --- Helpers ---

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status} ${res.statusText}`
  }
}
