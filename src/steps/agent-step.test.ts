import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import type { AgentConfig, AgentEvent, RunHandle } from "../agents/index.ts"
import { createEventBus } from "../events/index.ts"
import type { JobState } from "../jobs/job.types.ts"
import { createAsyncQueue } from "../utils/asyncQueue.ts"
import { runAgentStep } from "./agent-step.ts"

let activeFactory: (cfg: AgentConfig) => unknown = () => {
  throw new Error("No factory set")
}

mock.module("../agents/index.ts", () => ({
  createAgent: (cfg: AgentConfig) => activeFactory(cfg),
}))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-agentstep-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function jobState(): JobState {
  return {
    jobId: "j",
    flowId: "f",
    status: "running",
    startedAt: 0,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [{ runId: 0, startedAt: 0, steps: [] }],
  }
}

interface FakeAgentArgs {
  events: AgentEvent[]
  output: unknown
  provider?: string
  model?: string
}

function makeFakeAgentFactory(args: FakeAgentArgs) {
  return mock((cfg: AgentConfig) => {
    return {
      provider: cfg.provider,
      model: cfg.model,
      run() {
        const queue = createAsyncQueue<AgentEvent>()
        for (const e of args.events) queue.push(e)
        queue.close()
        const promise = Promise.resolve(args.output)
        const handle = promise as RunHandle<unknown>
        handle[Symbol.asyncIterator] = () => queue[Symbol.asyncIterator]()
        handle.output = promise
        return handle
      },
      close: () => Promise.resolve(),
    }
  })
}

test("uses agent config, writes NDJSON, emits agent.event, returns string output", async () => {
  const bus = createEventBus()
  const seenAgentEvents: string[] = []
  bus.on("agent.event", (e) => seenAgentEvents.push(e.type))

  const events: AgentEvent[] = [
    { type: "message.delta", timestamp: 1, data: { messageId: "m", delta: "hi" } },
    {
      type: "stats.updated",
      timestamp: 2,
      data: { tokens: { input: 7, output: 3 }, toolCalls: 1, costUsd: 0.02 },
    },
  ]
  const factory = makeFakeAgentFactory({ events, output: "Done." })
  activeFactory = factory
  const state = jobState()

  const result = await runAgentStep({
    name: "investigate",
    template: "Investigate {{INCIDENT_ID}}.",
    vars: { INCIDENT_ID: "INC-1" },
    options: { agent: { provider: "copilot", model: "gpt-5.2" } },
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    stateDir: dir,
    workspaceDir: dir,
    events: bus,
    signal: new AbortController().signal,
  })

  expect(result).toBe("Done.")
  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "copilot", model: "gpt-5.2" }),
  )

  const step = state.runs[0].steps[0]
  expect(step.status).toBe("done")
  expect(step.agent?.tokens).toEqual({ input: 7, output: 3 })
  expect(step.agent?.toolCalls).toBe(1)
  expect(state.totals.tokens).toEqual({ input: 7, output: 3 })
  expect(seenAgentEvents).toEqual(["agent.event", "agent.event"])

  const log = await readFile(step.agent?.logPath ?? "", "utf8")
  expect(log.trim().split("\n")).toHaveLength(2)
})

test("uses call-site agent config", async () => {
  const factory = makeFakeAgentFactory({ events: [], output: "ok" })
  activeFactory = factory
  const state = jobState()

  await runAgentStep({
    name: "step",
    template: "hi",
    vars: {},
    options: {
      agent: {
        provider: "codex",
        model: "gpt-5-codex",
        cwd: dir,
        codexOptions: { sandboxMode: "workspace-write" },
      },
    },
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    stateDir: dir,
    workspaceDir: dir,
    events: createEventBus(),
    signal: new AbortController().signal,
  })

  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "codex",
      model: "gpt-5-codex",
      cwd: dir,
      codexOptions: { sandboxMode: "workspace-write" },
    }),
  )
})

test("missing variable fails the step", async () => {
  const factory = makeFakeAgentFactory({ events: [], output: "" })
  activeFactory = factory
  const state = jobState()

  await expect(
    runAgentStep({
      name: "x",
      template: "{{MISSING}}",
      vars: {},
      options: { agent: { provider: "copilot", model: "m" } },
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      stateDir: dir,
      workspaceDir: dir,
      events: createEventBus(),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/MISSING/)

  expect(state.runs[0].steps[0].status).toBe("failed")
  expect(factory).not.toHaveBeenCalled()
})

test("schema validates output and returns typed result", async () => {
  const factory = makeFakeAgentFactory({
    events: [],
    output: { approved: true },
  })
  activeFactory = factory
  const state = jobState()

  const result = await runAgentStep<{ approved: boolean }>({
    name: "review",
    template: "review",
    vars: {},
    options: {
      agent: { provider: "copilot", model: "m" },
      schema: z.object({ approved: z.boolean() }),
    },
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    stateDir: dir,
    workspaceDir: dir,
    events: createEventBus(),
    signal: new AbortController().signal,
  })

  expect(result).toEqual({ approved: true })
})

test("provides built-in vars (JOB_DIR, WORKSPACE_DIR, FLOW_ID, JOB_ID, TODAY)", async () => {
  let renderedBody = ""
  const factory = mock(() => ({
    provider: "p",
    model: "m",
    run(opts: { messages: { content: string }[] }) {
      renderedBody = opts.messages[0].content
      const queue = createAsyncQueue<AgentEvent>()
      queue.close()
      const promise = Promise.resolve("ok")
      const h = promise as RunHandle<string>
      h[Symbol.asyncIterator] = () => queue[Symbol.asyncIterator]()
      h.output = promise
      return h
    },
    close: () => Promise.resolve(),
  }))
  activeFactory = factory

  await runAgentStep({
    name: "x",
    template: "{{JOB_DIR}}|{{WORKSPACE_DIR}}|{{FLOW_ID}}|{{JOB_ID}}|{{TODAY}}",
    vars: {},
    options: { agent: { provider: "copilot", model: "m" } },
    state: jobState(),
    flowId: "F",
    jobId: "J",
    runId: 0,
    stateDir: dir,
    workspaceDir: "/ws",
    events: createEventBus(),
    signal: new AbortController().signal,
  })

  expect(renderedBody).toContain(join(dir, "F", "J"))
  expect(renderedBody).toContain("/ws")
  expect(renderedBody).toContain("F")
  expect(renderedBody).toContain("J")
})

test("pre-aborted signal fails the step without calling the agent", async () => {
  const factory = makeFakeAgentFactory({ events: [], output: "ok" })
  activeFactory = factory
  const state = jobState()
  const ctrl = new AbortController()
  ctrl.abort()

  await expect(
    runAgentStep({
      name: "x",
      template: "hi",
      vars: {},
      options: { agent: { provider: "copilot", model: "m" } },
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      stateDir: dir,
      workspaceDir: dir,
      events: createEventBus(),
      signal: ctrl.signal,
    }),
  ).rejects.toThrow(/abort/i)

  expect(factory).not.toHaveBeenCalled()
  expect(state.runs[0].steps[0].status).toBe("failed")
})

test("agent output rejection ends step failed and rethrows the error", async () => {
  const factory = mock(() => ({
    provider: "p",
    model: "m",
    run() {
      const queue = createAsyncQueue<AgentEvent>()
      queue.close()
      const rejected = Promise.reject<string>(new Error("agent exploded"))
      rejected.catch(() => {}) // suppress unhandled rejection
      const placeholder = Promise.resolve("") as RunHandle<string>
      placeholder[Symbol.asyncIterator] = () => queue[Symbol.asyncIterator]()
      placeholder.output = rejected
      return placeholder
    },
    close: () => Promise.resolve(),
  }))
  activeFactory = factory
  const state = jobState()

  await expect(
    runAgentStep({
      name: "x",
      template: "hi",
      vars: {},
      options: { agent: { provider: "copilot", model: "m" } },
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      stateDir: dir,
      workspaceDir: dir,
      events: createEventBus(),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("agent exploded")

  expect(state.runs[0].steps[0].status).toBe("failed")
  expect(state.runs[0].steps[0].error).toBe("agent exploded")
})
