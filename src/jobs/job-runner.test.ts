import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import { loadState } from "../state/index.ts"
import type { JobContext } from "./job.types.ts"
import { runJob } from "./job-runner.ts"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-runner-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("happy path: status done, runs[0] has expected steps, persists state", async () => {
  const bus = createEventBus()
  const ended: string[] = []
  bus.on("job.end", (e) => {
    if (e.type === "job.end") ended.push(e.status)
  })

  await runJob({
    flowId: "f",
    jobId: "j",
    payload: { x: 1 },
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: new AbortController().signal,
    run: async (_payload: unknown, ctx: JobContext) => {
      await ctx.step("a", async () => {})
      await ctx.step("b", async () => {})
    },
  })

  expect(ended).toEqual(["done"])
  const state = await loadState(join(dir, "f", "j"))
  expect(state?.status).toBe("done")
  expect(state?.runs).toHaveLength(1)
  expect(state?.runs[0].steps.map((s) => s.name)).toEqual(["a", "b"])
})

test("throwing run() ends job failed", async () => {
  const bus = createEventBus()
  const ended: string[] = []
  bus.on("job.end", (e) => {
    if (e.type === "job.end") ended.push(e.status)
  })

  await runJob({
    flowId: "f",
    jobId: "j",
    payload: {},
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: new AbortController().signal,
    run: async () => {
      throw new Error("nope")
    },
  })

  expect(ended).toEqual(["failed"])
  const state = await loadState(join(dir, "f", "j"))
  expect(state?.status).toBe("failed")
})

test("aborted signal during run ends job stopped", async () => {
  const bus = createEventBus()
  const ended: string[] = []
  bus.on("job.end", (e) => {
    if (e.type === "job.end") ended.push(e.status)
  })

  const ctrl = new AbortController()
  await runJob({
    flowId: "f",
    jobId: "j",
    payload: {},
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: ctrl.signal,
    run: async (_p, ctx) => {
      ctrl.abort()
      await ctx.step("x", async () => {}) // will throw because signal aborted
    },
  })

  expect(ended).toEqual(["stopped"])
  const state = await loadState(join(dir, "f", "j"))
  expect(state?.status).toBe("stopped")
})

test("second run on existing state appends a new RunState (id increments)", async () => {
  const bus = createEventBus()

  await runJob({
    flowId: "f",
    jobId: "j",
    payload: {},
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: new AbortController().signal,
    run: async (_p, ctx) => {
      await ctx.step("a", async () => {})
    },
  })

  await runJob({
    flowId: "f",
    jobId: "j",
    payload: {},
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: new AbortController().signal,
    run: async (_p, ctx) => {
      await ctx.step("b", async () => {})
    },
  })

  const state = await loadState(join(dir, "f", "j"))
  expect(state?.runs).toHaveLength(2)
  expect(state?.runs[1].runId).toBe(1)
})

test("job.start is emitted before job.end", async () => {
  const bus = createEventBus()
  const emitted: string[] = []
  bus.on("*", (e) => emitted.push(e.type))

  await runJob({
    flowId: "f",
    jobId: "j",
    payload: {},
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: new AbortController().signal,
    run: async () => {},
  })

  expect(emitted).toContain("job.start")
  expect(emitted.indexOf("job.start")).toBeLessThan(emitted.indexOf("job.end"))
})

test("failed job captures error message in state and job.end event", async () => {
  const bus = createEventBus()
  const endEvents: { status: string; error?: string }[] = []
  bus.on("job.end", (e) => {
    if (e.type === "job.end") endEvents.push({ status: e.status, error: e.error })
  })

  await runJob({
    flowId: "f",
    jobId: "j",
    payload: {},
    workspaceDir: dir,
    stateDir: dir,
    events: bus,
    signal: new AbortController().signal,
    run: async () => {
      throw new Error("nope")
    },
  })

  const state = await loadState(join(dir, "f", "j"))
  expect(state?.error).toBe("nope")
  expect(endEvents[0].error).toBe("nope")
})
