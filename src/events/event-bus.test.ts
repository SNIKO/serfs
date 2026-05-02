import { expect, mock, test } from "bun:test"
import type { SerfsEvent } from "./event.types.ts"
import { createEventBus } from "./event-bus.ts"

test("subscribes to a specific event type and receives matching emits", () => {
  const bus = createEventBus()
  const handler = mock((_event: SerfsEvent) => {})
  bus.on("job.queued", handler)

  bus.emit({ type: "job.queued", flowId: "f", jobId: "j", at: 1 })
  bus.emit({ type: "job.start", flowId: "f", jobId: "j", runId: 0, at: 2 })

  expect(handler).toHaveBeenCalledTimes(1)
  expect(handler.mock.calls[0][0]).toEqual({ type: "job.queued", flowId: "f", jobId: "j", at: 1 })
})

test("subscribes with '*' and receives all events", () => {
  const bus = createEventBus()
  const handler = mock((_event: SerfsEvent) => {})
  bus.on("*", handler)

  bus.emit({ type: "job.queued", flowId: "f", jobId: "j", at: 1 })
  bus.emit({ type: "job.start", flowId: "f", jobId: "j", runId: 0, at: 2 })

  expect(handler).toHaveBeenCalledTimes(2)
})

test("returns unsubscribe function that removes the listener", () => {
  const bus = createEventBus()
  const handler = mock((_event: SerfsEvent) => {})
  const off = bus.on("job.queued", handler)

  bus.emit({ type: "job.queued", flowId: "f", jobId: "j", at: 1 })
  off()
  bus.emit({ type: "job.queued", flowId: "f", jobId: "j", at: 2 })

  expect(handler).toHaveBeenCalledTimes(1)
})

test("a throwing listener does not stop other listeners", () => {
  const bus = createEventBus()
  const bad = mock((_event: SerfsEvent) => {
    throw new Error("boom")
  })
  const good = mock((_event: SerfsEvent) => {})
  bus.on("job.queued", bad)
  bus.on("job.queued", good)

  bus.emit({ type: "job.queued", flowId: "f", jobId: "j", at: 1 })

  expect(bad).toHaveBeenCalled()
  expect(good).toHaveBeenCalled()
})
