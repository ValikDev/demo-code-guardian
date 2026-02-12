import { useState, type FormEvent } from 'react'
import { startScan, type ApiMode } from './api'
import { useScanPoller } from './useScanPoller'
import './styles.css'

const statusBadge: Record<string, string> = {
  queued: 'bg-slate-800 text-slate-400',
  scanning: 'bg-blue-950 text-yellow-400 animate-pulse-badge',
  finished: 'bg-green-950 text-green-400',
  failed: 'bg-red-950 text-red-400',
}

export function App() {
  const [repoUrl, setRepoUrl] = useState('https://github.com/OWASP/NodeGoat')
  const [scanId, setScanId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiMode, setApiMode] = useState<ApiMode>('rest')

  const { scan, error: pollError } = useScanPoller(scanId, apiMode)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setScanId(null)
    setLoading(true)

    try {
      const result = await startScan(repoUrl, apiMode)
      setScanId(result.scanId)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const isTerminal = scan?.status === 'Finished' || scan?.status === 'Failed'

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Code Guardian</h1>
        <p className="mt-1 text-sm text-slate-400">
          Security vulnerability scanner powered by Trivy
        </p>
      </header>

      <div className="mb-6 flex items-center justify-center gap-1 text-xs">
        {(['rest', 'graphql'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setApiMode(mode)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              apiMode === mode
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {mode === 'rest' ? 'REST' : 'GraphQL'}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={loading}
            required
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 font-mono text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={loading || (!isTerminal && scanId !== null)}
            className="whitespace-nowrap rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Scan'}
          </button>
        </div>
        {submitError && (
          <p className="mt-2 text-sm text-red-400">{submitError}</p>
        )}
      </form>

      {scanId && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-xs text-slate-400">
              Scan: {scanId.slice(0, 8)}...
            </span>
            {scan && (
              <span
                className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge[scan.status.toLowerCase()] ?? ''}`}
              >
                {scan.status}
              </span>
            )}
          </div>

          {pollError && (
            <p className="mb-3 text-sm text-red-400">Polling error: {pollError}</p>
          )}

          {scan?.status === 'Failed' && scan.error && (
            <div className="mb-4 rounded-lg border border-red-900 bg-red-950 p-4 text-sm">
              <strong>{scan.error.code}</strong>: {scan.error.message}
            </div>
          )}

          {scan?.status === 'Finished' && (
            <div>
              <h2 className="mb-4 text-base font-semibold">
                Critical Vulnerabilities ({scan.vulnerabilities.length})
                {scan.truncated && (
                  <span className="ml-1 text-sm font-normal text-yellow-400">
                    (truncated)
                  </span>
                )}
              </h2>

              {scan.vulnerabilities.length === 0 ? (
                <p className="py-8 text-center text-lg text-green-400">
                  No critical vulnerabilities found.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {scan.vulnerabilities.map((v, i) => (
                    <div
                      key={`${v.id}-${i}`}
                      className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold text-indigo-400">
                          {v.id}
                        </span>
                        <span className="rounded-md border border-red-900 bg-red-950 px-2 py-0.5 text-xs font-bold text-red-400">
                          CRITICAL
                        </span>
                      </div>
                      <h3 className="mb-2 text-sm font-semibold">
                        {v.title || 'No title'}
                      </h3>
                      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
                        <span>
                          Package: <strong className="text-slate-300">{v.package}</strong>
                        </span>
                        <span>
                          Installed:{' '}
                          <code className="rounded bg-slate-700/50 px-1.5 py-0.5 font-mono">
                            {v.installedVersion}
                          </code>
                        </span>
                        {v.fixedVersion && (
                          <span>
                            Fixed in:{' '}
                            <code className="rounded bg-slate-700/50 px-1.5 py-0.5 font-mono">
                              {v.fixedVersion}
                            </code>
                          </span>
                        )}
                      </div>
                      {v.description && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">
                          {v.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isTerminal && scan && (
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <span className="size-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
              Polling via {apiMode === 'graphql' ? 'GraphQL' : 'REST'} every 2s...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
