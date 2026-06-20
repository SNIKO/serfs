import { homedir } from "node:os"
import { join } from "node:path"

let testHomeDir: string | undefined

export function defaultHomeDir(): string {
  if (testHomeDir !== undefined) return testHomeDir
  return join(homedir(), ".serfs")
}

export function setHomeDirForTest(homeDir?: string): void {
  testHomeDir = homeDir
}

export function flowJobsDir(flowId: string, homeDir = defaultHomeDir()): string {
  return join(homeDir, "flows", pathSegment(flowId), "jobs")
}

export function jobDir(flowId: string, jobId: string, homeDir = defaultHomeDir()): string {
  return join(homeDir, "flows", pathSegment(flowId), "jobs", pathSegment(jobId))
}

export function jobStatePath(flowId: string, jobId: string, homeDir = defaultHomeDir()): string {
  return join(jobDir(flowId, jobId, homeDir), "state.json")
}

export function runDir(
  flowId: string,
  jobId: string,
  runId: number,
  homeDir = defaultHomeDir(),
): string {
  return join(jobDir(flowId, jobId, homeDir), "runs", String(runId))
}

export function runLogsDir(
  flowId: string,
  jobId: string,
  runId: number,
  homeDir = defaultHomeDir(),
): string {
  return join(runDir(flowId, jobId, runId, homeDir), "logs")
}

export function agentLogPath(
  flowId: string,
  jobId: string,
  runId: number,
  step: string,
  provider: string,
  model: string,
  homeDir = defaultHomeDir(),
): string {
  const filename = `${sanitize(step)}-${sanitize(provider)}-${sanitize(model)}.log`
  return join(runLogsDir(flowId, jobId, runId, homeDir), filename)
}

function pathSegment(part: string): string {
  return encodeURIComponent(part)
}

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9.-]/g, "_")
}
