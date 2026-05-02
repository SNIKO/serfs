export interface RunHandle {
  signal: AbortSignal
  abort(): void
}

export interface QueueEntry<T> {
  flowId: string
  jobId: string
  payload: T
}

export interface NextResult<T> {
  entry: QueueEntry<T>
  handle: RunHandle
}

export interface JobQueueOptions {
  globalLimit: number
}

export interface JobQueue<T> {
  enqueue(entry: QueueEntry<T>, opts: { flowLimit: number }): void
  has(flowId: string, jobId: string): boolean
  next(): NextResult<T> | undefined
  stop(flowId: string, jobId: string): void
  markFinished(handle: RunHandle): void
  size(): { queued: number; running: number }
}

interface InternalEntry<T> extends QueueEntry<T> {
  flowLimit: number
}

const handleKeys = new WeakMap<RunHandle, string>()

export function createJobQueue<T>(options: JobQueueOptions): JobQueue<T> {
  const queued: InternalEntry<T>[] = []
  const running = new Map<string, { entry: InternalEntry<T>; controller: AbortController }>()

  function makeKey(flowId: string, jobId: string) {
    return `${flowId}:${jobId}`
  }

  function flowRunning(flowId: string): number {
    let n = 0
    for (const r of running.values()) if (r.entry.flowId === flowId) n++
    return n
  }

  return {
    enqueue(entry, opts) {
      queued.push({ ...entry, flowLimit: opts.flowLimit })
    },

    has(flowId, jobId) {
      const k = makeKey(flowId, jobId)
      if (running.has(k)) return true
      return queued.some((e) => e.flowId === flowId && e.jobId === jobId)
    },

    next() {
      if (running.size >= options.globalLimit) return undefined

      for (let i = 0; i < queued.length; i++) {
        const candidate = queued[i]
        if (flowRunning(candidate.flowId) >= candidate.flowLimit) continue

        queued.splice(i, 1)
        const controller = new AbortController()
        const key = makeKey(candidate.flowId, candidate.jobId)
        running.set(key, { entry: candidate, controller })

        const handle: RunHandle = {
          signal: controller.signal,
          abort: () => controller.abort(),
        }
        handleKeys.set(handle, key)

        return {
          entry: {
            flowId: candidate.flowId,
            jobId: candidate.jobId,
            payload: candidate.payload,
          },
          handle,
        }
      }
      return undefined
    },

    stop(flowId, jobId) {
      running.get(makeKey(flowId, jobId))?.controller.abort()
    },

    markFinished(handle) {
      const key = handleKeys.get(handle)
      if (!key) return
      running.delete(key)
      handleKeys.delete(handle)
    },

    size() {
      return { queued: queued.length, running: running.size }
    },
  }
}
