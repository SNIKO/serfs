import { expect, mock, test } from "bun:test"
import { createEventBus } from "../events/index.ts"
import { createJobQueue } from "../jobs/index.ts"
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
  const stop = startFlowScheduler({ flow: makeFlow(["a"]), queue, events: bus, sleep: clock.sleep })

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
  const stop = startFlowScheduler({ flow, queue, events: bus, sleep: () => Promise.resolve() })
  await Promise.resolve()
  expect(fetchJobs).not.toHaveBeenCalled()
  stop()
})
