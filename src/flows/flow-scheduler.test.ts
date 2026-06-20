import { expect, mock, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventBus } from "../events/index.ts"
import { createJobQueue } from "../jobs/index.ts"
import type { JobState } from "../jobs/job.types.ts"
import { jobDir, saveState, setHomeDirForTest } from "../state/index.ts"
import type { Flow } from "./flow.types.ts"
import { startFlowScheduler } from "./flow-scheduler.ts"

interface Tick {
  fire(): Promise<void>
}

function fakeClock(): { sleep: (ms: number) => Promise<void>; tick: Tick } {
  let resolveCurrent: (() => void) | null = null
  return {
    sleep: () =>
      new Promise<void>((res) => {
        resolveCurrent = res
      }),
    tick: {
      async fire() {
        while (!resolveCurrent) await new Promise((resolve) => setTimeout(resolve, 0))
        resolveCurrent?.()
        resolveCurrent = null
        await Promise.resolve()
      },
    },
  }
}

function makeFlow(
  jobIds: string[],
  overrides: Partial<Flow<{ id: string }>> = {},
): Flow<{ id: string }> {
  return {
    id: "f",
    config: { workspaceDir: "/", maxConcurrentJobs: 1, pollIntervalMs: 1 },
    fetchJobs: async () => jobIds.map((id) => ({ id })),
    getJobId: (j) => j.id,
    isRunnable: async () => true,
    run: async () => {},
    ...overrides,
  }
}

test("enqueues newly-discovered jobs and emits job.queued", async () => {
  const bus = createEventBus()
  const queuedIds: string[] = []
  bus.on("job.queued", (e) => {
    if (e.type === "job.queued") queuedIds.push(e.jobId)
  })

  const queue = createJobQueue<unknown>({ globalLimit: 10 })
  const clock = fakeClock()
  const stop = startFlowScheduler({
    flow: makeFlow(["a", "b"]),
    queue,
    events: bus,
    sleep: clock.sleep,
  })

  await clock.tick.fire()
  await Promise.resolve()
  expect(queuedIds.sort()).toEqual(["a", "b"])
  expect(queue.size().queued).toBe(2)
  stop()
})

test("does not re-enqueue jobs already queued or running", async () => {
  const bus = createEventBus()
  const queue = createJobQueue<unknown>({ globalLimit: 10 })
  const clock = fakeClock()
  const stop = startFlowScheduler({
    flow: makeFlow(["a"]),
    queue,
    events: bus,
    sleep: clock.sleep,
  })

  await clock.tick.fire()
  await Promise.resolve()
  await clock.tick.fire()
  await Promise.resolve()

  expect(queue.size().queued).toBe(1)
  stop()
})

test("isRunnable=false emits job.removed and skips enqueue", async () => {
  const bus = createEventBus()
  const removedIds: string[] = []
  bus.on("job.removed", (e) => {
    if (e.type === "job.removed") removedIds.push(e.jobId)
  })

  const queue = createJobQueue<unknown>({ globalLimit: 10 })
  const clock = fakeClock()
  const stop = startFlowScheduler({
    flow: makeFlow(["a"], { isRunnable: async () => false }),
    queue,
    events: bus,
    sleep: clock.sleep,
  })

  await clock.tick.fire()
  await Promise.resolve()

  expect(removedIds).toEqual(["a"])
  expect(queue.size().queued).toBe(0)
  stop()
})

test("flow with enabled=false does not poll", async () => {
  const bus = createEventBus()
  const queue = createJobQueue<unknown>({ globalLimit: 10 })
  const fetchJobs = mock(() => Promise.resolve<{ id: string }[]>([]))
  const flow: Flow<{ id: string }> = {
    id: "off",
    config: { workspaceDir: "/", enabled: false },
    fetchJobs,
    getJobId: (j) => j.id,
    isRunnable: async () => true,
    run: async () => {},
  }
  const stop = startFlowScheduler({
    flow,
    queue,
    events: bus,
    sleep: () => Promise.resolve(),
  })
  await Promise.resolve()
  expect(fetchJobs).not.toHaveBeenCalled()
  stop()
})

test("fetchJobs error is swallowed and the scheduler retries on the next poll", async () => {
  const bus = createEventBus()
  const queue = createJobQueue<unknown>({ globalLimit: 10 })
  const clock = fakeClock()
  const errorSpy = spyOn(console, "error").mockImplementation(() => {})
  let callCount = 0
  const stop = startFlowScheduler({
    flow: makeFlow([], {
      fetchJobs: async () => {
        callCount++
        if (callCount === 1) throw new Error("network down")
        return [{ id: "a" }]
      },
    }),
    queue,
    events: bus,
    sleep: clock.sleep,
  })

  await clock.tick.fire() // first poll throws; scheduler reaches sleep
  await Promise.resolve()
  expect(queue.size().queued).toBe(0)

  await clock.tick.fire() // second poll succeeds
  await Promise.resolve()
  expect(queue.size().queued).toBe(1)
  stop()
  errorSpy.mockRestore()
})

test("passes loaded state to isRunnable when a state file exists", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "serfs-sched-"))
  setHomeDirForTest(tmpDir)
  try {
    const bus = createEventBus()
    const queue = createJobQueue<unknown>({ globalLimit: 10 })
    const clock = fakeClock()

    const existingState: JobState = {
      jobId: "a",
      flowId: "f",
      status: "done",
      startedAt: 1,
      totals: { tokens: { input: 0, output: 0 } },
      runs: [],
    }
    await saveState(jobDir("f", "a", tmpDir), existingState)

    // Use a latch so the test waits for isRunnable to be called regardless of I/O timing
    let resolveReceived!: (s: JobState | null) => void
    const receivedPromise = new Promise<JobState | null>((r) => {
      resolveReceived = r
    })

    const stop = startFlowScheduler({
      flow: makeFlow(["a"], {
        isRunnable: async (_job, state) => {
          resolveReceived(state as JobState | null)
          return true
        },
      }),
      queue,
      events: bus,
      sleep: clock.sleep,
    })

    const receivedState = await receivedPromise
    stop()

    expect(receivedState).not.toBeNull()
    expect((receivedState as JobState).jobId).toBe("a")
    expect((receivedState as JobState).status).toBe("done")
  } finally {
    setHomeDirForTest()
    await rm(tmpDir, { recursive: true, force: true })
  }
})
