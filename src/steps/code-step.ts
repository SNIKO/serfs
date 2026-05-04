import type { EventBus } from "../events/index.ts"
import type { JobState } from "../jobs/job.types.ts"
import { saveState } from "../state/index.ts"
import { appendStep, finalizeStep, startStep } from "./step-record.ts"

export interface RunCodeStepArgs {
  name: string
  fn: () => Promise<void>
  state: JobState
  jobDir: string
  flowId: string
  jobId: string
  runId: number
  events: EventBus
  signal: AbortSignal
}

export async function runCodeStep(args: RunCodeStepArgs): Promise<void> {
  const { name, fn, state, jobDir, flowId, jobId, runId, events, signal } = args

  const step = appendStep(state, name)

  if (signal.aborted) {
    finalizeStep(step, { status: "failed", endedAt: Date.now(), error: "aborted" })
    await saveState(jobDir, state)
    throw new Error("Step aborted before start")
  }

  startStep(step, Date.now())
  await saveState(jobDir, state)
  events.emit({ type: "step.start", flowId, jobId, runId, step: name, at: step.startedAt ?? 0 })

  try {
    await fn()
    finalizeStep(step, { status: "done", endedAt: Date.now() })
    await saveState(jobDir, state)
    events.emit({
      type: "step.end",
      flowId,
      jobId,
      runId,
      step: name,
      at: step.endedAt ?? 0,
      status: "done",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    finalizeStep(step, { status: "failed", endedAt: Date.now(), error: message })
    await saveState(jobDir, state)
    events.emit({
      type: "step.end",
      flowId,
      jobId,
      runId,
      step: name,
      at: step.endedAt ?? 0,
      status: "failed",
      error: message,
    })
    throw err
  }
}
