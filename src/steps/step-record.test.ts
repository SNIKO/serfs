import { expect, test } from "bun:test"
import type { JobState, RunState, StepState } from "../jobs/job.types.ts"
import { appendStep, applyAgentStats, finalizeStep, startStep } from "./step-record.ts"

function makeJobState(): JobState {
  return {
    jobId: "j",
    flowId: "f",
    status: "running",
    startedAt: 0,
    totals: { tokens: { input: 0, output: 0 } },
    runs: [{ runId: 0, startedAt: 0, steps: [] } satisfies RunState],
  }
}

test("appendStep adds a pending step to the latest run", () => {
  const s = makeJobState()
  const step = appendStep(s, "investigate")
  expect(step.status).toBe("pending")
  expect(s.runs[0].steps).toHaveLength(1)
  expect(s.runs[0].steps[0]).toBe(step)
})

test("startStep marks step running and sets startedAt", () => {
  const s = makeJobState()
  const step = appendStep(s, "x")
  startStep(step, 42)
  expect(step.status).toBe("running")
  expect(step.startedAt).toBe(42)
})

test("finalizeStep marks done with endedAt", () => {
  const s = makeJobState()
  const step = appendStep(s, "x")
  startStep(step, 0)
  finalizeStep(step, { status: "done", endedAt: 99 })
  expect(step.status).toBe("done")
  expect(step.endedAt).toBe(99)
})

test("finalizeStep failed with error captures the message", () => {
  const s = makeJobState()
  const step = appendStep(s, "x")
  finalizeStep(step, { status: "failed", endedAt: 1, error: "boom" })
  expect(step.status).toBe("failed")
  expect(step.error).toBe("boom")
})

test("applyAgentStats updates step.agent and accumulates job totals", () => {
  const s = makeJobState()
  const step: StepState = appendStep(s, "x")
  applyAgentStats(s, step, {
    provider: "copilot",
    model: "gpt-5.2",
    logPath: "/log",
  })
  applyAgentStats(s, step, {
    tokens: { input: 100, output: 50 },
    toolCalls: 3,
    costUsd: 0.04,
  })

  expect(step.agent?.provider).toBe("copilot")
  expect(step.agent?.tokens).toEqual({ input: 100, output: 50 })
  expect(step.agent?.toolCalls).toBe(3)
  expect(step.agent?.costUsd).toBe(0.04)

  expect(s.totals.tokens).toEqual({ input: 100, output: 50 })
  expect(s.totals.costUsd).toBe(0.04)
})

test("applyAgentStats delta-accumulates job totals across repeated stats.updated calls", () => {
  const s = makeJobState()
  const step: StepState = appendStep(s, "x")
  applyAgentStats(s, step, { provider: "p", model: "m", logPath: "/" })

  // Simulate two stats.updated events with increasing cumulative token counts
  applyAgentStats(s, step, { tokens: { input: 100, output: 50 }, costUsd: 0.04 })
  applyAgentStats(s, step, { tokens: { input: 200, output: 80 }, costUsd: 0.08 })

  // Step holds the latest cumulative value
  expect(step.agent?.tokens).toEqual({ input: 200, output: 80 })
  expect(step.agent?.costUsd).toBe(0.08)
  // Job totals match the latest value — delta logic prevents double-counting
  expect(s.totals.tokens).toEqual({ input: 200, output: 80 })
  expect(s.totals.costUsd).toBeCloseTo(0.08)
})

test("applyAgentStats accumulates job totals independently across two steps", () => {
  const s = makeJobState()
  const stepA: StepState = appendStep(s, "a")
  const stepB: StepState = appendStep(s, "b")

  applyAgentStats(s, stepA, { tokens: { input: 100, output: 50 }, costUsd: 0.04 })
  applyAgentStats(s, stepB, { tokens: { input: 200, output: 80 }, costUsd: 0.06 })

  expect(s.totals.tokens).toEqual({ input: 300, output: 130 })
  expect(s.totals.costUsd).toBeCloseTo(0.1)
})
