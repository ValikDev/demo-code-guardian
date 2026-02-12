import { useEffect, useRef, useCallback, useState } from 'react'
import { getScan, type ApiMode, type ScanResponse } from './api'

const POLL_INTERVAL_MS = 2_000

export function useScanPoller(scanId: string | null, mode: ApiMode) {
  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!scanId) {
      setScan(null)
      setError(null)
      return
    }

    let active = true

    const poll = async () => {
      try {
        const data = await getScan(scanId, mode)
        if (!active) return
        setScan(data)

        if (data.status === 'Finished' || data.status === 'Failed') {
          stop()
        }
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
        stop()
      }
    }

    void poll()
    timerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS)

    return () => {
      active = false
      stop()
    }
  }, [scanId, mode, stop])

  return { scan, error }
}
