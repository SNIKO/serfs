import type { EventBus } from "../events/index.ts"
import { jobDir as buildJobDir, loadState, saveState } from "../state/index.ts"
import type { AgentFactory } from "../steps/index.ts"
import type { JobContext, JobState, JobStatus } from "./job.types.ts"
import { buildJobContext } from "./job-context.ts"

export interface RunJobArgs<TPayload> {
  flowId: string
  jobId: string
  payload: TPayload
  workspaceDir: string
  stateDir: string
  events: EventBus
  signal: AbortSignal
  createAgent: AgentFactory
  run: (payload: TPayload, ctx: JobContext) => Promise<void>
}

export async function runJob<TPayload>(args: RunJobArgs<TPayload>): Promise<void> {
  const dir = buildJobDir(args.stateDir, args.flowId, args.jobId)
  const state = await initState(dir, args)
  const runId = state.runs[state.runs.length - 1].id

  args.events.emit({
    type: "job.start",
    flowId: args.flowId,
    jobId: args.jobId,
    runId,
    at: Date.now(),
  })

  const ctx = buildJobContext({
    flowId: args.flowId,
    jobId: args.jobId,
    runId,
    stateDir: args.stateDir,
    workspaceDir: args.workspaceDir,
    state,
    signal: args.signal,
    events: args.events,
    createAgent: args.createAgent,
  })

  const status = await executeRun(args, ctx)
  state.status = status
  state.endedAt = Date.now()
  state.runs[state.runs.length - 1].endedAt = state.endedAt
  await saveState(dir, state)

  args.events.emit({
    type: "job.end",
    flowId: args.flowId,
    jobId: args.jobId,
    runId,
    at: state.endedAt,
    status,
  })
}

async function initState<TPayload>(dir: string, args: RunJobArgs<TPayload>): Promise<JobState> {
  const existing = await loadState(dir)
  const nextRunId = existing ? existing.runs.length : 0
  const state: JobState = existing ?? {
    id: args.jobId,
    flowId: args.flowId,
    status: "running",
    startedAt: Date.now(),
    totals: { tokens: { input: 0, output: 0 } },
    runs: [],
  }
  state.status = "running"
  state.runs.push({ id: nextRunId, startedAt: Date.now(), steps: [] })
  await saveState(dir, state)
  return state
}

async function executeRun<TPayload>(
  args: RunJobArgs<TPayload>,
  ctx: JobContext,
): Promise<JobStatus> {
  try {
    await args.run(args.payload, ctx)
    return "done"
  } catch {
    return args.signal.aborted ? "stopped" : "failed"
  }
}
