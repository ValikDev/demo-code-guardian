export const DEFAULT_PORT = 4000
export const DEFAULT_QUEUE_MAX_SIZE = 10
export const DEFAULT_QUEUE_MAX_CONCURRENT = 1
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000
export const DEFAULT_REGISTRY_MAX_ENTRIES = 50
export const DEFAULT_REGISTRY_MAX_VULNS_PER_SCAN = 10_000
export const DEFAULT_RETRY_AFTER_SECONDS = 30
export const DEFAULT_WORKER_MAX_OLD_SPACE_SIZE = 150
// Must exceed the sum of engine timeouts (clone 120s + trivy 300s + parse buffer)
// so the worker's finally-block cleanup can run before the manager kills it.
export const DEFAULT_WORKER_TIMEOUT_MS = 480_000
export const DEFAULT_WORKER_SHUTDOWN_GRACE_MS = 5_000
