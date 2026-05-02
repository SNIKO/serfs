import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import type { JobState } from "../jobs/job.types.ts"
import { runCodeStep } from "./code-step.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-codestep-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fixture(): JobState {
  return {
    id: "j",
    flowId: "f",
    status: "running",
    startedAt: 0,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [{ id: 0, startedAt: 0, steps: [] }],
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
    jobDir: dir,
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
      jobDir: dir,
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
      jobDir: dir,
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
