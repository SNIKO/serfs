import { type Agent, type AgentConfig, createAgent as defaultCreateAgent } from "../agents/index.ts"
import { type DashboardHandle, startDashboard } from "../dashboard/index.ts"
import { createEventBus, type EventBus, type SerfsEvent } from "../events/index.ts"
import { createFlowRegistry, type FlowRegistry, startFlowScheduler } from "../flows/index.ts"
import { createJobQueue, type JobQueue, runJob } from "../jobs/index.ts"
import { type SerfsConfig, type SerfsConfigInput, validateConfig } from "./config.ts"

export interface Serfs {
  start(): Promise<void>
  stop(): Promise<void>
  on(type: SerfsEvent["type"] | "*", listener: (event: SerfsEvent) => void): () => void
  stopJob(flowId: string, jobId: string): void
}

export interface CreateSerfsArgs extends SerfsConfigInput {
  createAgent?: (config: AgentConfig) => Agent
}

export function createSerfs(input: CreateSerfsArgs): Serfs {
  const config: SerfsConfig = validateConfig(input)
  const events = createEventBus()
  const registry = createFlowRegistry()
  for (const flow of config.flows) registry.register(flow)

  const queue = createJobQueue<unknown>({ globalLimit: config.maxConcurrentJobs })
  const createAgent = input.createAgent ?? defaultCreateAgent

  let stopFlows: (() => void)[] = []
  let pumpStopped = false
  let dashboard: DashboardHandle | undefined

  return {
    async start() {
      stopFlows = config.flows.map((flow) =>
        startFlowScheduler({ flow, queue, events, stateDir: config.stateDir }),
      )
      pumpStopped = false
      void runJobPump({
        config,
        queue,
        events,
        registry,
        createAgent,
        isStopped: () => pumpStopped,
      })
      if (config.dashboard.enabled) {
        dashboard = startDashboard({
          port: config.dashboard.port,
          host: config.dashboard.host,
          registry,
          queue,
          events,
          stateDir: config.stateDir,
        })
      }
    },

    async stop() {
      pumpStopped = true
      for (const fn of stopFlows) fn()
      stopFlows = []
      if (dashboard) {
        await dashboard.stop()
        dashboard = undefined
      }
    },

    on(type, listener) {
      return events.on(type, listener)
    },

    stopJob(flowId, jobId) {
      queue.stop(flowId, jobId)
    },
  }
}

interface PumpArgs {
  config: SerfsConfig
  queue: JobQueue<unknown>
  events: EventBus
  registry: FlowRegistry
  createAgent: (config: AgentConfig) => Agent
  isStopped: () => boolean
}

async function runJobPump(p: PumpArgs): Promise<void> {
  while (!p.isStopped()) {
    const next = p.queue.next()
    if (!next) {
      await sleep(50)
      continue
    }

    const flow = p.registry.get(next.entry.flowId)
    if (!flow) {
      p.queue.markFinished(next.handle)
      continue
    }

    void (async () => {
      try {
        await runJob({
          flowId: flow.id,
          jobId: next.entry.jobId,
          payload: next.entry.payload,
          workspaceDir: flow.config.workspaceDir,
          stateDir: p.config.stateDir,
          events: p.events,
          signal: next.handle.signal,
          createAgent: p.createAgent,
          run: (payload, ctx) => flow.run(payload, ctx),
        })
      } finally {
        p.queue.markFinished(next.handle)
      }
    })()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
