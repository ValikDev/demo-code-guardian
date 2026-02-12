export type Job = {
  scanId: string
  repoUrl: string
}

export type JobQueueConfig = {
  maxQueued: number
  maxConcurrent: number
}

export function createJobQueue(config: JobQueueConfig) {
  const pending: Job[] = []
  let activeCount = 0
  let processor: ((job: Job) => void) | null = null

  function tryProcess(): void {
    while (processor && activeCount < config.maxConcurrent && pending.length > 0) {
      activeCount++
      const job = pending.shift()
      if (job) processor(job)
    }
  }

  return {
    setProcessor(fn: (job: Job) => void): void {
      processor = fn
      tryProcess()
    },

    enqueue(job: Job): boolean {
      if (pending.length >= config.maxQueued) return false
      pending.push(job)
      tryProcess()
      return true
    },

    onJobComplete(): void {
      activeCount = Math.max(0, activeCount - 1)
      tryProcess()
    },

    get isFull(): boolean {
      return pending.length >= config.maxQueued
    },

    get pending(): number {
      return pending.length
    },

    get active(): number {
      return activeCount
    },
  }
}

export type JobQueue = ReturnType<typeof createJobQueue>
