import type { AgentState, JobState, StepState } from "../jobs/job.types.ts"

export function currentRun(state: JobState) {
  const last = state.runs[state.runs.length - 1]
  if (!last) throw new Error("currentRun: no run on JobState")
  return last
}

export function appendStep(state: JobState, name: string): StepState {
  const step: StepState = { name, status: "pending" }
  currentRun(state).steps.push(step)
  return step
}

export function startStep(step: StepState, at: number): void {
  step.status = "running"
  step.startedAt = at
}

export interface FinalizeArgs {
  status: "done" | "failed"
  endedAt: number
  error?: string
}

export function finalizeStep(step: StepState, args: FinalizeArgs): void {
  step.status = args.status
  step.endedAt = args.endedAt
  if (args.error !== undefined) step.error = args.error
}

export interface AgentStatsPatch {
  provider?: string
  model?: string
  logPath?: string
  tokens?: { input?: number; output?: number }
  costUsd?: number
  toolCalls?: number
}

export function applyAgentStats(state: JobState, step: StepState, patch: AgentStatsPatch): void {
  step.agent ??= emptyAgentState()

  if (patch.provider !== undefined) step.agent.provider = patch.provider
  if (patch.model !== undefined) step.agent.model = patch.model
  if (patch.logPath !== undefined) step.agent.logPath = patch.logPath

  if (patch.tokens) {
    const beforeIn = step.agent.tokens.input
    const beforeOut = step.agent.tokens.output
    if (patch.tokens.input !== undefined) step.agent.tokens.input = patch.tokens.input
    if (patch.tokens.output !== undefined) step.agent.tokens.output = patch.tokens.output

    state.totals.tokens.input += step.agent.tokens.input - beforeIn
    state.totals.tokens.output += step.agent.tokens.output - beforeOut
  }

  if (patch.toolCalls !== undefined) {
    step.agent.toolCalls = patch.toolCalls
  }

  if (patch.costUsd !== undefined) {
    const before = step.agent.costUsd ?? 0
    step.agent.costUsd = patch.costUsd
    state.totals.costUsd = (state.totals.costUsd ?? 0) + (patch.costUsd - before)
  }
}

function emptyAgentState(): AgentState {
  return {
    provider: "",
    model: "",
    tokens: { input: 0, output: 0 },
    toolCalls: 0,
    logPath: "",
  }
}
