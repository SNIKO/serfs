import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import type { Flow } from "../flows/index.ts"
import { createFlowRegistry } from "../flows/index.ts"
import { createJobQueue } from "../jobs/index.ts"
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
