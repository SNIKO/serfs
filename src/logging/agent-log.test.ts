import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentEvent } from "../agents/index.ts"
import { createAgentLog } from "./agent-log.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-log-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const event: AgentEvent = {
  type: "message.delta",
  timestamp: 1,
  data: { messageId: "m1", delta: "hi" },
}

test("writes one JSON object per event, separated by newlines", async () => {
  const log = await createAgentLog(join(dir, "logs", "step-p-m.log"))
  await log.write(event)
  await log.write({ ...event, timestamp: 2 })
  await log.close()

  const contents = await readFile(join(dir, "logs", "step-p-m.log"), "utf8")
  const lines = contents.trim().split("\n")
  expect(lines).toHaveLength(2)
  expect(JSON.parse(lines[0])).toEqual(event)
  expect(JSON.parse(lines[1]).timestamp).toBe(2)
})

test("creates the parent directory if missing", async () => {
  const log = await createAgentLog(join(dir, "deep", "nested", "f.log"))
  await log.write(event)
  await log.close()

  const exists = await readFile(join(dir, "deep", "nested", "f.log"), "utf8")
  expect(exists.trim().length).toBeGreaterThan(0)
})

test("write does not throw after close (no-op)", async () => {
  const log = await createAgentLog(join(dir, "f.log"))
  await log.close()
  await log.write(event)
  // no exception = pass
})
