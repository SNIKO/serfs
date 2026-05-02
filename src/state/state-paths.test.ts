import { expect, test } from "bun:test"
import { agentLogPath, jobDir, jobStatePath, runDir, runLogsDir } from "./state-paths.ts"

test("jobDir builds {stateDir}/{flowId}/{jobId}", () => {
  expect(jobDir("/var/serfs", "incidents", "INC-1")).toBe("/var/serfs/incidents/INC-1")
})

test("jobStatePath ends in state.json", () => {
  expect(jobStatePath("/var/serfs", "incidents", "INC-1")).toBe(
    "/var/serfs/incidents/INC-1/state.json",
  )
})

test("runDir builds runs/{runId}", () => {
  expect(runDir("/var/serfs", "incidents", "INC-1", 0)).toBe("/var/serfs/incidents/INC-1/runs/0")
})

test("runLogsDir builds runs/{runId}/logs", () => {
  expect(runLogsDir("/var/serfs", "incidents", "INC-1", 2)).toBe(
    "/var/serfs/incidents/INC-1/runs/2/logs",
  )
})

test("agentLogPath uses {step}-{provider}-{model}.log", () => {
  const path = agentLogPath(
    "/var/serfs",
    "incidents",
    "INC-1",
    0,
    "investigate",
    "copilot",
    "gpt-5.2",
  )
  expect(path).toBe("/var/serfs/incidents/INC-1/runs/0/logs/investigate-copilot-gpt-5.2.log")
})

test("agentLogPath sanitizes filesystem-unsafe chars in model names", () => {
  const path = agentLogPath("/s", "f", "j", 0, "step", "p", "claude/sonnet:latest")
  expect(path).toBe("/s/f/j/runs/0/logs/step-p-claude_sonnet_latest.log")
})
