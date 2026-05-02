import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JobState } from "../jobs/job.types.ts"
import { loadState, saveState } from "./state-store.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serfs-state-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const sample: JobState = {
  id: "INC-1",
  flowId: "incidents",
  status: "running",
  startedAt: 1,
  totals: { tokens: { input: 0, output: 0 } },
  runs: [],
}

test("loadState returns null when state.json does not exist", async () => {
  expect(await loadState(dir)).toBeNull()
})

test("saveState writes state.json that loadState can read", async () => {
  await saveState(dir, sample)
  const loaded = await loadState(dir)
  expect(loaded).toEqual(sample)
})

test("saveState creates the parent directory if missing", async () => {
  const nested = join(dir, "a", "b")
  await saveState(nested, sample)
  const loaded = await loadState(nested)
  expect(loaded).toEqual(sample)
})

test("saveState does not leave a .tmp file behind on success", async () => {
  await saveState(dir, sample)
  const tmp = join(dir, "state.json.tmp")
  let exists = true
  try {
    await readFile(tmp)
  } catch {
    exists = false
  }
  expect(exists).toBe(false)
})
