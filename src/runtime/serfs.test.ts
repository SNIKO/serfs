import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Flow } from "../flows/index.ts"
import { createSerfs } from "./serfs.ts"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-runtime-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function eagerFlow(jobId: string): Flow<{ id: string }> {
  return {
    id: "f",
    config: { workspaceDir: "/", maxConcurrentJobs: 1, pollIntervalMs: 5 },
    fetchJobs: async () => [{ id: jobId }],
    getJobId: (j) => j.id,
    isRunnable: async () => true,
    run: async (_j, ctx) => {
      await ctx.step("a", async () => {})
    },
  }
}

test("start/stop lifecycle: throws on bad config; processes one job end-to-end", async () => {
  const serfs = createSerfs({
    stateDir: dir,
    maxConcurrentJobs: 1,
    flows: [eagerFlow("J1")],
    dashboard: { enabled: false },
  })

  const events: string[] = []
  serfs.on("job.end", (e) => {
    if (e.type === "job.end") events.push(`${e.jobId}:${e.status}`)
  })

  await serfs.start()

  await new Promise<void>((resolve) => {
    const off = serfs.on("job.end", () => {
      off()
      resolve()
    })
  })

  await serfs.stop()
  expect(events).toEqual(["J1:done"])
})

test("invalid config throws synchronously from createSerfs", () => {
  expect(() =>
    createSerfs({
      stateDir: "",
      maxConcurrentJobs: 1,
      flows: [eagerFlow("J")],
    } as never),
  ).toThrow(/stateDir/)
})

test("stopJob aborts the running job before the next step", async () => {
  let stopRef: (flowId: string, jobId: string) => void = () => {}

  const stopFlow: Flow<{ id: string }> = {
    id: "stop-test",
    config: { workspaceDir: dir, maxConcurrentJobs: 1, pollIntervalMs: 5 },
    fetchJobs: async () => [{ id: "J2" }],
    getJobId: (j) => j.id,
    isRunnable: async () => true,
    run: async (_j, ctx) => {
      await ctx.step("a", async () => {})
      stopRef("stop-test", "J2") // abort signal before next step
      await ctx.step("b", async () => {}) // should throw due to aborted signal
    },
  }

  const serfs = createSerfs({
    stateDir: dir,
    maxConcurrentJobs: 1,
    flows: [stopFlow],
    dashboard: { enabled: false },
  })
  stopRef = (fId, jId) => serfs.stopJob(fId, jId)

  await serfs.start()

  const status = await new Promise<string>((resolve) => {
    const off = serfs.on("job.end", (e) => {
      if (e.type === "job.end") {
        off()
        resolve(e.status)
      }
    })
  })

  await serfs.stop()
  expect(status).toBe("stopped")
})
