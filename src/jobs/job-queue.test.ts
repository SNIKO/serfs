import { expect, test } from "bun:test"
import { createJobQueue } from "./job-queue.ts"

const entry = (flowId: string, jobId: string, payload: { x: number } = { x: 0 }) => ({
  flowId,
  jobId,
  payload,
})

test("dequeues entries in FIFO order when slots are unlimited", () => {
  const queue = createJobQueue<{ x: number }>({ globalLimit: 10 })
  queue.enqueue(entry("a", "1"), { flowLimit: 10 })
  queue.enqueue(entry("a", "2"), { flowLimit: 10 })
  queue.enqueue(entry("b", "1"), { flowLimit: 10 })

  expect(queue.next()?.entry.jobId).toBe("1")
  expect(queue.next()?.entry.jobId).toBe("2")
  expect(queue.next()?.entry.jobId).toBe("1")
  expect(queue.next()).toBeUndefined()
})

test("respects the global concurrency limit", () => {
  const queue = createJobQueue<{ x: number }>({ globalLimit: 1 })
  queue.enqueue(entry("a", "1"), { flowLimit: 10 })
  queue.enqueue(entry("a", "2"), { flowLimit: 10 })

  const first = queue.next()
  expect(first?.entry.jobId).toBe("1")
  expect(queue.next()).toBeUndefined()

  if (first) queue.markFinished(first.handle)
  expect(queue.next()?.entry.jobId).toBe("2")
})

test("respects per-flow concurrency limit while another flow can still run", () => {
  const queue = createJobQueue<{ x: number }>({ globalLimit: 10 })
  queue.enqueue(entry("a", "1"), { flowLimit: 1 })
  queue.enqueue(entry("a", "2"), { flowLimit: 1 })
  queue.enqueue(entry("b", "1"), { flowLimit: 10 })

  const first = queue.next()
  expect(first?.entry.jobId).toBe("1")
  const second = queue.next()
  expect(second?.entry.flowId).toBe("b")
  expect(queue.next()).toBeUndefined()

  if (first) queue.markFinished(first.handle)
  expect(queue.next()?.entry.jobId).toBe("2")
})

test("has() returns true for queued and running jobs, false otherwise", () => {
  const queue = createJobQueue<{ x: number }>({ globalLimit: 10 })
  queue.enqueue(entry("a", "1"), { flowLimit: 10 })
  expect(queue.has("a", "1")).toBe(true)

  const taken = queue.next()
  expect(queue.has("a", "1")).toBe(true)

  if (taken) queue.markFinished(taken.handle)
  expect(queue.has("a", "1")).toBe(false)
})

test("running entries expose an AbortSignal that fires on stop()", () => {
  const queue = createJobQueue<{ x: number }>({ globalLimit: 10 })
  queue.enqueue(entry("a", "1"), { flowLimit: 10 })
  const taken = queue.next()
  expect(taken).toBeDefined()
  if (!taken) return

  expect(taken.handle.signal.aborted).toBe(false)
  queue.stop("a", "1")
  expect(taken.handle.signal.aborted).toBe(true)
})

test("entry.payload preserves the original job descriptor", () => {
  const queue = createJobQueue<{ x: number }>({ globalLimit: 10 })
  queue.enqueue(entry("a", "1", { x: 42 }), { flowLimit: 10 })
  expect(queue.next()?.entry.payload).toEqual({ x: 42 })
})
