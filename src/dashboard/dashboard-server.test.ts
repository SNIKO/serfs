import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import type { Flow } from "../flows/index.ts"
import { createFlowRegistry } from "../flows/index.ts"
import { createJobQueue } from "../jobs/index.ts"
import { agentLogPath, jobDir, runLogsDir, saveState, setHomeDirForTest } from "../state/index.ts"
import { createSseStream } from "./dashboard-events.ts"
import { startDashboard } from "./dashboard-server.ts"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-dash-"))
  setHomeDirForTest(dir)
})
afterEach(async () => {
  setHomeDirForTest()
  await rm(dir, { recursive: true, force: true })
})

const flow = (id: string): Flow => ({
  id,
  config: { workspaceDir: "/" },
  fetchJobs: async () => [],
  getJobId: () => "",
  isRunnable: async () => true,
  run: async () => {},
})

test("GET / serves the SPA placeholder", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()
  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("Serfs Dashboard")
  } finally {
    await dash.stop()
  }
})

test("GET /api/flows returns registered flows", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  registry.register(flow("b"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()
  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/flows`)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((f) => f.id).sort()).toEqual(["a", "b"])
  } finally {
    await dash.stop()
  }
})

test("GET /api/flows/:id/jobs/:jobId returns the persisted job state", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  await saveState(jobDir("a", "J1", dir), {
    jobId: "J1",
    flowId: "a",
    status: "done",
    startedAt: 1,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [],
  })

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/flows/a/jobs/J1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { jobId: string; status: string }
    expect(body.jobId).toBe("J1")
    expect(body.status).toBe("done")
  } finally {
    await dash.stop()
  }
})

test("POST /api/flows/:id/jobs/:jobId/stop returns 204 and aborts the job signal", async () => {
  const registry = createFlowRegistry()
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  queue.enqueue({ flowId: "a", jobId: "J1", payload: null }, { flowLimit: 1 })
  const running = queue.next()

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/flows/a/jobs/J1/stop`, {
      method: "POST",
    })
    expect(res.status).toBe(204)
    expect(running?.handle.signal.aborted).toBe(true)
  } finally {
    await dash.stop()
  }
})

test("GET /api/events returns a text/event-stream response", () => {
  const events = createEventBus()
  const res = createSseStream({ events })
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  expect(res.headers.get("x-accel-buffering")).toBe("no")
  res.body?.cancel()
})

test("GET /api/unknown-endpoint returns 404", async () => {
  const registry = createFlowRegistry()
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()
  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/unknown-endpoint`)
    expect(res.status).toBe(404)
  } finally {
    await dash.stop()
  }
})

test("GET /api/flows/:id/jobs lists jobs filtered by status (default queued,running)", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  await saveState(jobDir("a", "J1", dir), {
    jobId: "J1",
    flowId: "a",
    status: "running",
    startedAt: 1000,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [],
  })
  await saveState(jobDir("a", "J2", dir), {
    jobId: "J2",
    flowId: "a",
    status: "done",
    startedAt: 2000,
    endedAt: 3000,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [],
  })

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/flows/a/jobs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { jobId: string; status: string }[]
    expect(body.length).toBe(1)
    expect(body[0].jobId).toBe("J1")
    expect(body[0].status).toBe("running")
  } finally {
    await dash.stop()
  }
})

test("GET /api/flows/:id/jobs respects ?status and ?limit/?offset", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  for (const [id, startedAt] of [
    ["J1", 1000],
    ["J2", 2000],
    ["J3", 3000],
  ] as [string, number][]) {
    await saveState(jobDir("a", id, dir), {
      jobId: id,
      flowId: "a",
      status: "done",
      startedAt,
      endedAt: startedAt + 500,
      totals: { tokens: { input: 0, output: 0 } },
      runs: [],
    })
  }

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res1 = await fetch(
      `http://127.0.0.1:${dash.port}/api/flows/a/jobs?status=done&limit=2&offset=0`,
    )
    const page1 = (await res1.json()) as { jobId: string }[]
    expect(page1.map((j) => j.jobId)).toEqual(["J3", "J2"])

    const res2 = await fetch(
      `http://127.0.0.1:${dash.port}/api/flows/a/jobs?status=done&limit=2&offset=2`,
    )
    const page2 = (await res2.json()) as { jobId: string }[]
    expect(page2.map((j) => j.jobId)).toEqual(["J1"])
  } finally {
    await dash.stop()
  }
})

test("GET /api/flows/:id/jobs returns [] for an unknown flow", async () => {
  const registry = createFlowRegistry()
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/flows/no-such-flow/jobs`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  } finally {
    await dash.stop()
  }
})

test("GET …/runs/:runId/steps/:step/log returns NDJSON from the agent log file", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  const logContent = '{"type":"text_delta","delta":"hello"}\n'

  await saveState(jobDir("a", "J1", dir), {
    jobId: "J1",
    flowId: "a",
    status: "done",
    startedAt: 1000,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [
      {
        runId: 0,
        startedAt: 1000,
        steps: [
          {
            name: "analyze",
            status: "done",
            agent: {
              provider: "anthropic",
              model: "claude-opus-4-5",
              tokens: { input: 100, output: 50 },
              toolCalls: 0,
              logPath: agentLogPath("a", "J1", 0, "analyze", "anthropic", "claude-opus-4-5", dir),
            },
          },
        ],
      },
    ],
  })

  const logDir = runLogsDir("a", "J1", 0, dir)
  await mkdir(logDir, { recursive: true })
  await writeFile(
    agentLogPath("a", "J1", 0, "analyze", "anthropic", "claude-opus-4-5", dir),
    logContent,
  )

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(
      `http://127.0.0.1:${dash.port}/api/flows/a/jobs/J1/runs/0/steps/analyze/log`,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/x-ndjson")
    const body = await res.text()
    expect(body).toBe(logContent)
  } finally {
    await dash.stop()
  }
})

test("GET …/runs/:runId/steps/:step/log returns 404 when step has no agent", async () => {
  const registry = createFlowRegistry()
  registry.register(flow("a"))
  const queue = createJobQueue({ globalLimit: 1 })
  const events = createEventBus()

  await saveState(jobDir("a", "J1", dir), {
    jobId: "J1",
    flowId: "a",
    status: "done",
    startedAt: 1000,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [
      {
        runId: 0,
        startedAt: 1000,
        steps: [{ name: "analyze", status: "done" }],
      },
    ],
  })

  const dash = startDashboard({
    port: 0,
    host: "127.0.0.1",
    registry,
    queue,
    events,
  })

  try {
    const res = await fetch(
      `http://127.0.0.1:${dash.port}/api/flows/a/jobs/J1/runs/0/steps/analyze/log`,
    )
    expect(res.status).toBe(404)
  } finally {
    await dash.stop()
  }
})

test("GET /api/events sends stream.ready as first frame", async () => {
  const events = createEventBus()
  const res = createSseStream({ events })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()

  const { value } = await reader.read()
  const text = decoder.decode(value)
  expect(text).toBe('data: {"type":"stream.ready"}\n\n')

  reader.cancel()
})

test("GET /api/events suppresses agent.event frames where inner type is raw", async () => {
  const bus = createEventBus()
  const res = createSseStream({ events: bus })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()

  // Consume the initial stream.ready frame
  await reader.read()

  // Emit a raw event — should be suppressed
  bus.emit({
    type: "agent.event",
    flowId: "a",
    jobId: "J1",
    runId: 0,
    step: "s",
    provider: "anthropic",
    model: "claude-opus-4-5",
    event: { type: "raw", timestamp: Date.now(), provider: "claude", data: {} },
  })

  // Emit a non-raw event — should appear
  bus.emit({
    type: "job.queued",
    flowId: "a",
    jobId: "J1",
    at: 1000,
  })

  // Give the stream a tick to flush
  await new Promise((r) => setTimeout(r, 10))

  // Read one chunk — should be job.queued, not the raw event
  const chunks: string[] = []
  const { value, done } = await reader.read()
  if (!done && value) chunks.push(decoder.decode(value))

  reader.cancel()

  expect(chunks.length).toBe(1)
  expect(chunks[0]).toContain('"type":"job.queued"')
})
