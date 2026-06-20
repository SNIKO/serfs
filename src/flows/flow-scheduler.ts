import type { EventBus } from "../events/index.ts"
import type { JobQueue } from "../jobs/index.ts"
import { jobDir as buildJobDir, loadState } from "../state/index.ts"
import type { Flow } from "./flow.types.ts"

export const DEFAULT_POLL_INTERVAL_MS = 30_000

export interface FlowSchedulerArgs<TJob> {
  flow: Flow<TJob>
  queue: JobQueue<TJob>
  events: EventBus
  sleep?: (ms: number) => Promise<void>
}

export function startFlowScheduler<TJob>(args: FlowSchedulerArgs<TJob>): () => void {
  if (args.flow.config.enabled === false) {
    return () => {}
  }

  let stopped = false
  const sleep = args.sleep ?? defaultSleep
  const interval = args.flow.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  void (async () => {
    while (!stopped) {
      try {
        await pollOnce(args)
      } catch (err) {
        console.error(`[serfs] flow ${args.flow.id} poll failed:`, err)
      }
      await sleep(interval)
    }
  })()

  return () => {
    stopped = true
  }
}

async function pollOnce<TJob>(args: FlowSchedulerArgs<TJob>): Promise<void> {
  const { flow, queue, events } = args
  const jobs = await flow.fetchJobs()

  for (const job of jobs) {
    const jobId = flow.getJobId(job)
    if (queue.has(flow.id, jobId)) continue

    const state = await loadState(buildJobDir(flow.id, jobId))
    const runnable = await flow.isRunnable(job, state)
    if (!runnable) {
      events.emit({
        type: "job.removed",
        flowId: flow.id,
        jobId,
        at: Date.now(),
        reason: "not-runnable",
      })
      continue
    }

    queue.enqueue(
      { flowId: flow.id, jobId, payload: job },
      { flowLimit: flow.config.maxConcurrentJobs ?? Number.MAX_SAFE_INTEGER },
    )
    events.emit({ type: "job.queued", flowId: flow.id, jobId, at: Date.now() })
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
