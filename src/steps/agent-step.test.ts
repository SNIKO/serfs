import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import type { AgentEvent, RunHandle } from "../agents/index.ts"
import { createEventBus } from "../events/index.ts"
import type { JobState } from "../jobs/job.types.ts"
import { createAsyncQueue } from "../utils/asyncQueue.ts"
import { runAgentStep } from "./agent-step.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-agentstep-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function jobState(): JobState {
  return {
    id: "j",
    flowId: "f",
    status: "running",
    startedAt: 0,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [{ id: 0, startedAt: 0, steps: [] }],
  }
}

interface FakeAgentArgs {
  events: AgentEvent[]
  output: string
  provider?: string
  model?: string
}

function makeFakeAgentFactory(args: FakeAgentArgs) {
  return mock((cfg: { provider: string; model: string }) => {
    return {
      provider: cfg.provider,
      model: cfg.model,
      run() {
        const queue = createAsyncQueue<AgentEvent>()
        for (const e of args.events) queue.push(e)
        queue.close()
        const promise = Promise.resolve(args.output)
        const handle = promise as RunHandle<string>
        handle[Symbol.asyncIterator] = () => queue[Symbol.asyncIterator]()
        handle.output = promise
        return handle
      },
      close: () => Promise.resolve(),
    }
  })
}

test("renders frontmatter provider/model, writes NDJSON, emits agent.event, returns string output", async () => {
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
  const state = jobState()

  const result = await runAgentStep({
    name: "investigate",
    template: `---
provider: copilot
model: gpt-5.2
---
Investigate {{INCIDENT_ID}}.`,
    vars: { INCIDENT_ID: "INC-1" },
    options: {},
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    stateDir: dir,
    workspaceDir: dir,
    events: bus,
    signal: new AbortController().signal,
    createAgent: factory,
  })

  expect(result).toBe("Done.")
  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "copilot", model: "gpt-5.2", cwd: dir }),
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

test("call-site provider/model overrides frontmatter", async () => {
  const factory = makeFakeAgentFactory({ events: [], output: "ok" })
  const state = jobState()

  await runAgentStep({
    name: "step",
    template: `---
provider: copilot
model: a
---
hi`,
    vars: {},
    options: { provider: "codex", model: "gpt-5-codex" },
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    stateDir: dir,
    workspaceDir: dir,
    events: createEventBus(),
    signal: new AbortController().signal,
    createAgent: factory,
  })

  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "codex", model: "gpt-5-codex" }),
  )
})

test("missing variable fails the step", async () => {
  const factory = makeFakeAgentFactory({ events: [], output: "" })
  const state = jobState()

  await expect(
    runAgentStep({
      name: "x",
      template: "---\nprovider: copilot\nmodel: m\n---\n{{MISSING}}",
      vars: {},
      options: {},
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      stateDir: dir,
      workspaceDir: dir,
      events: createEventBus(),
      signal: new AbortController().signal,
      createAgent: factory,
    }),
  ).rejects.toThrow(/MISSING/)

  expect(state.runs[0].steps[0].status).toBe("failed")
  expect(factory).not.toHaveBeenCalled()
})

test("schema validates output and returns typed result", async () => {
  const factory = makeFakeAgentFactory({
    events: [],
    output: '{"approved": true}',
  })
  const state = jobState()

  const result = await runAgentStep<{ approved: boolean }>({
    name: "review",
    template: "---\nprovider: copilot\nmodel: m\n---\nreview",
    vars: {},
    options: { schema: z.object({ approved: z.boolean() }) },
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    stateDir: dir,
    workspaceDir: dir,
    events: createEventBus(),
    signal: new AbortController().signal,
    createAgent: factory,
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

  await runAgentStep({
    name: "x",
    template:
      "---\nprovider: p\nmodel: m\n---\n{{JOB_DIR}}|{{WORKSPACE_DIR}}|{{FLOW_ID}}|{{JOB_ID}}|{{TODAY}}",
    vars: {},
    options: {},
    state: jobState(),
    flowId: "F",
    jobId: "J",
    runId: 0,
    stateDir: dir,
    workspaceDir: "/ws",
    events: createEventBus(),
    signal: new AbortController().signal,
    createAgent: factory,
  })

  expect(renderedBody).toContain(join(dir, "F", "J"))
  expect(renderedBody).toContain("/ws")
  expect(renderedBody).toContain("F")
  expect(renderedBody).toContain("J")
})
