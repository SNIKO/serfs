import type { EventBus } from "../events/index.ts"
import { type AgentFactory, runAgentStep, runCodeStep } from "../steps/index.ts"
import type { AgentCallOptions, JobContext, JobState } from "./job.types.ts"

export interface BuildJobContextArgs {
  flowId: string
  jobId: string
  runId: number
  stateDir: string
  workspaceDir: string
  state: JobState
  signal: AbortSignal
  events: EventBus
  createAgent: AgentFactory
}

export function buildJobContext(args: BuildJobContextArgs): JobContext {
  const jobDirPath = `${args.stateDir}/${args.flowId}/${args.jobId}`

  return {
    jobId: args.jobId,
    flowId: args.flowId,
    runId: args.runId,
    workspaceDir: args.workspaceDir,
    jobDir: jobDirPath,
    state: args.state,

    step(name, fn) {
      return runCodeStep({
        name,
        fn,
        state: args.state,
        jobDir: jobDirPath,
        flowId: args.flowId,
        jobId: args.jobId,
        runId: args.runId,
        events: args.events,
        signal: args.signal,
      })
    },

    agent<T = string>(
      template: string,
      vars?: Record<string, string>,
      options?: AgentCallOptions<T>,
    ) {
      return runAgentStep<T>({
        name: options?.name ?? "agent",
        template,
        vars: vars ?? {},
        options: options ?? {},
        state: args.state,
        flowId: args.flowId,
        jobId: args.jobId,
        runId: args.runId,
        stateDir: args.stateDir,
        workspaceDir: args.workspaceDir,
        events: args.events,
        signal: args.signal,
        createAgent: args.createAgent,
      })
    },
  }
}
