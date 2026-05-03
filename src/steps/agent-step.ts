import { join } from "node:path"
import type { z } from "zod"
import type { AgentEvent, McpServerConfig, Provider } from "../agents/index.ts"
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
    provider?: string
    model?: string
    schema?: z.ZodSchema<T>
    mcpServers?: Record<string, McpServerConfig>
  }
  state: JobState
  flowId: string
  jobId: string
  runId: number
  stateDir: string
  workspaceDir: string
  events: EventBus
  signal: AbortSignal
}

export async function runAgentStep<T = string>(args: RunAgentStepArgs<T>): Promise<T> {
  const { name, state, flowId, jobId, runId, events, signal } = args
  const step = appendStep(state, name)

  if (signal.aborted) {
    finalizeStep(step, { status: "failed", endedAt: Date.now(), error: "aborted" })
    await saveState(buildJobDir(args.stateDir, flowId, jobId), state)
    throw new Error("Agent step aborted before start")
  }

  startStep(step, Date.now())
  await saveState(buildJobDir(args.stateDir, flowId, jobId), state)
  events.emit({ type: "step.start", flowId, jobId, runId, step: name, at: step.startedAt ?? 0 })

  try {
    const result = await executeAgent(args, step)
    finalizeStep(step, { status: "done", endedAt: Date.now() })
    await saveState(buildJobDir(args.stateDir, flowId, jobId), state)
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
    await saveState(buildJobDir(args.stateDir, flowId, jobId), state)
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
  const provider = args.options.provider ?? parsed.frontmatter.provider
  const model = args.options.model ?? parsed.frontmatter.model
  if (!provider) throw new Error(`Agent step "${args.name}": no provider in frontmatter or options`)
  if (!model) throw new Error(`Agent step "${args.name}": no model in frontmatter or options`)

  const builtins = builtinVars({
    flowId: args.flowId,
    jobId: args.jobId,
    stateDir: args.stateDir,
    workspaceDir: args.workspaceDir,
  })
  const allVars = { ...builtins, ...args.vars }
  const body = renderPrompt(parsed, allVars)

  const logPath = agentLogPath(
    args.stateDir,
    args.flowId,
    args.jobId,
    args.runId,
    args.name,
    provider,
    model,
  )
  const log = await createAgentLog(logPath)

  applyAgentStats(args.state, step, { provider, model, logPath })

  const agent = createAgent({
    provider: provider as Provider,
    model,
    cwd: args.workspaceDir,
    mcpServers: args.options.mcpServers,
  })
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
  stateDir: string
  workspaceDir: string
}): Record<string, string> {
  return {
    JOB_DIR: join(args.stateDir, args.flowId, args.jobId),
    WORKSPACE_DIR: args.workspaceDir,
    FLOW_ID: args.flowId,
    JOB_ID: args.jobId,
    TODAY: new Date().toISOString().slice(0, 10),
  }
}
