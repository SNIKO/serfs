import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import type { JobState } from "../jobs/job.types.ts"
import { jobDir, loadState, setHomeDirForTest } from "../state/index.ts"
import { runCodeStep } from "./code-step.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-codestep-"))
  setHomeDirForTest(dir)
})
afterEach(async () => {
  setHomeDirForTest()
  await rm(dir, { recursive: true, force: true })
})

function fixture(): JobState {
  return {
    jobId: "j",
    flowId: "f",
    status: "running",
    startedAt: 0,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [{ runId: 0, startedAt: 0, steps: [] }],
  }
}

test("happy path: emits step.start, runs fn, emits step.end status=done, persists state", async () => {
  const bus = createEventBus()
  const events: string[] = []
  bus.on("*", (e) => events.push(e.type))
  const fn = mock(() => Promise.resolve())
  const state = fixture()

  await runCodeStep({
    name: "send",
    fn,
    state,
    flowId: "f",
    jobId: "j",
    runId: 0,
    events: bus,
    signal: new AbortController().signal,
  })

  expect(fn).toHaveBeenCalled()
  expect(events).toEqual(["step.start", "step.end"])
  expect(state.runs[0].steps[0].status).toBe("done")
})

test("fn throws: step ends failed and the error propagates", async () => {
  const bus = createEventBus()
  const state = fixture()

  await expect(
    runCodeStep({
      name: "send",
      fn: () => Promise.reject(new Error("kaboom")),
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      events: bus,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("kaboom")

  expect(state.runs[0].steps[0].status).toBe("failed")
  expect(state.runs[0].steps[0].error).toBe("kaboom")
})

test("aborts before running fn when signal already aborted", async () => {
  const bus = createEventBus()
  const fn = mock(() => Promise.resolve())
  const state = fixture()
  const ctrl = new AbortController()
  ctrl.abort()

  await expect(
    runCodeStep({
      name: "x",
      fn,
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      events: bus,
      signal: ctrl.signal,
    }),
  ).rejects.toThrow(/abort/i)

  expect(fn).not.toHaveBeenCalled()
  expect(state.runs[0].steps[0].status).toBe("failed")
})

test("fn throws: step.end event carries failed status and error message", async () => {
  const bus = createEventBus()
  const endEvents: { status: string; error?: string }[] = []
  bus.on("step.end", (e) => {
    if (e.type === "step.end") endEvents.push({ status: e.status, error: e.error })
  })
  const state = fixture()

  await expect(
    runCodeStep({
      name: "send",
      fn: () => Promise.reject(new Error("kaboom")),
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      events: bus,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("kaboom")

  expect(endEvents).toHaveLength(1)
  expect(endEvents[0].status).toBe("failed")
  expect(endEvents[0].error).toBe("kaboom")
})

test("abort: step state is persisted to disk as failed before throwing", async () => {
  const bus = createEventBus()
  const fn = mock(() => Promise.resolve())
  const state = fixture()
  const ctrl = new AbortController()
  ctrl.abort()

  await expect(
    runCodeStep({
      name: "x",
      fn,
      state,
      flowId: "f",
      jobId: "j",
      runId: 0,
      events: bus,
      signal: ctrl.signal,
    }),
  ).rejects.toThrow()

  const persisted = await loadState(jobDir("f", "j", dir))
  expect(persisted?.runs[0].steps[0].status).toBe("failed")
})
