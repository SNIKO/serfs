import { join } from "node:path"

export function jobDir(stateDir: string, flowId: string, jobId: string): string {
  return join(stateDir, flowId, jobId)
}

export function jobStatePath(stateDir: string, flowId: string, jobId: string): string {
  return join(jobDir(stateDir, flowId, jobId), "state.json")
}

export function runDir(stateDir: string, flowId: string, jobId: string, runId: number): string {
  return join(jobDir(stateDir, flowId, jobId), "runs", String(runId))
}

export function runLogsDir(stateDir: string, flowId: string, jobId: string, runId: number): string {
  return join(runDir(stateDir, flowId, jobId, runId), "logs")
}

export function agentLogPath(
  stateDir: string,
  flowId: string,
  jobId: string,
  runId: number,
  step: string,
  provider: string,
  model: string,
): string {
  const filename = `${sanitize(step)}-${sanitize(provider)}-${sanitize(model)}.log`
  return join(runLogsDir(stateDir, flowId, jobId, runId), filename)
}

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9.-]/g, "_")
}
