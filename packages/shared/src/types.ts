export type ScanStatus = 'Queued' | 'Scanning' | 'Finished' | 'Failed'

export type ScanErrorCode =
  | 'TRIVY_FAILED'
  | 'CLONE_FAILED'
  | 'DISK_FULL'
  | 'PARSE_FAILED'
  | 'TIMEOUT'
  | 'OOM'
  | 'UNKNOWN'

export type ScanError = {
  code: ScanErrorCode
  message: string
}

export type Vulnerability = {
  id: string
  package: string
  installedVersion: string
  fixedVersion: string | null
  severity: 'CRITICAL'
  title: string
  description: string
}

export type ScanRecord = {
  scanId: string
  repoUrl: string
  status: ScanStatus
  vulnerabilities: Vulnerability[]
  truncated: boolean
  error: ScanError | null
  createdAt: Date
  updatedAt: Date
}
