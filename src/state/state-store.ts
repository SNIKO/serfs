import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { JobState } from "../jobs/job.types.ts"

export async function loadState(jobDirPath: string): Promise<JobState | null> {
  const path = join(jobDirPath, "state.json")
  try {
    const raw = await readFile(path, "utf8")
    return JSON.parse(raw) as JobState
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function saveState(jobDirPath: string, state: JobState): Promise<void> {
  await mkdir(jobDirPath, { recursive: true })
  const path = join(jobDirPath, "state.json")
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
  await rename(tmp, path)
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  )
}
