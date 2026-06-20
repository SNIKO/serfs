import type { z } from "zod"
import type { AgentConfig, AgentEvent } from "../agents/index.ts"
import { createAgent } from "../agents/index.ts"
import type { EventBus } from "../events/index.ts"
import type { JobState, StepState } from "../jobs/job.types.ts"
import { createAgentLog } from "../logging/index.ts"
import { parsePrompt, renderPrompt } from "../prompts/index.ts"
import { agentLogPath, jobDir as buildJobDir, saveState } from "../state/index.ts"
import { appendStep, applyAgentStats, finalizeStep, startStep } from "./step-record.ts"

export interface RunAgentStepArgs<T> {
  name: string
  template: string
  vars: Record<string, string>
  options: {
    agent: AgentConfig
    schema?: z.ZodSchema<T>
  }
  state: JobState
  flowId: string
  jobId: string
  runId: number
  workspaceDir: string
  events: EventBus
  signal: AbortSignal
}

export async function runAgentStep<T = string>(args: RunAgentStepArgs<T>): Promise<T> {
  const { name, state, flowId, jobId, runId, events, signal } = args
  const step = appendStep(state, name)

  if (signal.aborted) {
    finalizeStep(step, { status: "failed", endedAt: Date.now(), error: "aborted" })
    await saveState(buildJobDir(flowId, jobId), state)
    throw new Error("Agent step aborted before start")
  }

  startStep(step, Date.now())
  await saveState(buildJobDir(flowId, jobId), state)
  events.emit({ type: "step.start", flowId, jobId, runId, step: name, at: step.startedAt ?? 0 })

  try {
    const result = await executeAgent(args, step)
    finalizeStep(step, { status: "done", endedAt: Date.now() })
    await saveState(buildJobDir(flowId, jobId), state)
    events.emit({
      type: "step.end",
      flowId,
      jobId,
      runId,
      step: name,
      at: step.endedAt ?? 0,
      status: "done",
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    finalizeStep(step, { status: "failed", endedAt: Date.now(), error: message })
    await saveState(buildJobDir(flowId, jobId), state)
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

async function executeAgent<T>(args: RunAgentStepArgs<T>, step: StepState): Promise<T> {
  const parsed = parsePrompt(args.template)
  const agentConfig = args.options.agent
  const { provider, model } = agentConfig

  const builtins = builtinVars({
    flowId: args.flowId,
    jobId: args.jobId,
    runId: args.runId,
    workspaceDir: args.workspaceDir,
  })
  const allVars = { ...builtins, ...args.vars }
  const body = renderPrompt(parsed, allVars)

  const logPath = agentLogPath(args.flowId, args.jobId, args.runId, args.name, provider, model)
  const log = await createAgentLog(logPath)

  applyAgentStats(args.state, step, { provider, model, logPath })

  const agent = createAgent({ ...agentConfig, cwd: agentConfig.cwd ?? args.workspaceDir })
  const handle = agent.run({
    messages: [{ role: "user", content: body }],
    abortSignal: args.signal,
    outputSchema: args.options.schema,
  })

  try {
    for await (const event of handle) {
      await log.write(event)
      args.events.emit({
        type: "agent.event",
        flowId: args.flowId,
        jobId: args.jobId,
        runId: args.runId,
        step: args.name,
        provider,
        model,
        event,
      })
      if (event.type === "stats.updated") {
        applyStatsEvent(args.state, step, event)
      }
    }

    const response = await handle.output
    return response
  } finally {
    await log.close()
    await agent.close()
  }
}

function applyStatsEvent(
  state: JobState,
  step: StepState,
  event: Extract<AgentEvent, { type: "stats.updated" }>,
): void {
  applyAgentStats(state, step, {
    tokens: event.data.tokens,
    toolCalls: event.data.toolCalls,
    costUsd: event.data.costUsd,
  })
}

function builtinVars(args: {
  flowId: string
  jobId: string
  runId: number
  workspaceDir: string
}): Record<string, string> {
  return {
    WORKSPACE_DIR: args.workspaceDir,
    FLOW_ID: args.flowId,
    JOB_ID: args.jobId,
    RUN_ID: String(args.runId),
    TODAY: new Date().toISOString().slice(0, 10),
  }
}
