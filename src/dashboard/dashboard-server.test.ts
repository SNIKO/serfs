import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import type { Flow } from "../flows/index.ts"
import { createFlowRegistry } from "../flows/index.ts"
import { createJobQueue } from "../jobs/index.ts"
import { saveState } from "../state/index.ts"
import { createSseStream } from "./dashboard-events.ts"
import { startDashboard } from "./dashboard-server.ts"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-dash-"))
})
afterEach(async () => {
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
    stateDir: dir,
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
    stateDir: dir,
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

  await saveState(join(dir, "a", "J1"), {
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
    stateDir: dir,
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
    stateDir: dir,
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
    stateDir: dir,
  })

  try {
    const res = await fetch(`http://127.0.0.1:${dash.port}/api/unknown-endpoint`)
    expect(res.status).toBe(404)
  } finally {
    await dash.stop()
  }
})
