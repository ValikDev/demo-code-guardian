import type { ScanError, ScanStatus, Vulnerability } from './types.js'

// --- Messages sent FROM orchestrator TO worker ---

export type StartMessage = {
  type: 'start'
  payload: {
    scanId: string
    repoUrl: string
  }
}

export type OrchestratorMessage = StartMessage

// --- Messages sent FROM worker TO orchestrator ---

export type StatusMessage = {
  type: 'status'
  scanId: string
  status: Extract<ScanStatus, 'Scanning' | 'Finished'>
}

export type VulnsMessage = {
  type: 'vulns'
  scanId: string
  vulnerabilities: Vulnerability[]
}

export type ErrorMessage = {
  type: 'error'
  scanId: string
  error: ScanError
}

export type WorkerMessage = StatusMessage | VulnsMessage | ErrorMessage

// --- Type guards ---

export function isOrchestratorMessage(msg: unknown): msg is OrchestratorMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'start' &&
    typeof obj.payload === 'object' &&
    obj.payload !== null &&
    typeof (obj.payload as Record<string, unknown>).scanId === 'string' &&
    typeof (obj.payload as Record<string, unknown>).repoUrl === 'string'
  )
}

export function isWorkerMessage(msg: unknown): msg is WorkerMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  if (typeof obj.scanId !== 'string') return false

  switch (obj.type) {
    case 'status':
      return obj.status === 'Scanning' || obj.status === 'Finished'
    case 'vulns':
      return Array.isArray(obj.vulnerabilities)
    case 'error':
      return (
        typeof obj.error === 'object' &&
        obj.error !== null &&
        typeof (obj.error as Record<string, unknown>).code === 'string' &&
        typeof (obj.error as Record<string, unknown>).message === 'string'
      )
    default:
      return false
  }
}
