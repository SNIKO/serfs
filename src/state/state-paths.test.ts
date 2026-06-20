import { expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  agentLogPath,
  defaultHomeDir,
  jobDir,
  jobStatePath,
  runDir,
  runLogsDir,
} from "./state-paths.ts"

test("defaultHomeDir returns ~/.serfs", () => {
  expect(defaultHomeDir()).toBe(join(homedir(), ".serfs"))
})

test("jobDir builds {homeDir}/flows/{flowId}/jobs/{jobId}", () => {
  expect(jobDir("incidents", "INC-1", "/var/serfs")).toBe("/var/serfs/flows/incidents/jobs/INC-1")
})

test("jobStatePath ends in state.json", () => {
  expect(jobStatePath("incidents", "INC-1", "/var/serfs")).toBe(
    "/var/serfs/flows/incidents/jobs/INC-1/state.json",
  )
})

test("runDir builds runs/{runId}", () => {
  expect(runDir("incidents", "INC-1", 0, "/var/serfs")).toBe(
    "/var/serfs/flows/incidents/jobs/INC-1/runs/0",
  )
})

test("runLogsDir builds runs/{runId}/logs", () => {
  expect(runLogsDir("incidents", "INC-1", 2, "/var/serfs")).toBe(
    "/var/serfs/flows/incidents/jobs/INC-1/runs/2/logs",
  )
})

test("agentLogPath uses {step}-{provider}-{model}.log", () => {
  const path = agentLogPath(
    "incidents",
    "INC-1",
    0,
    "investigate",
    "copilot",
    "gpt-5.2",
    "/var/serfs",
  )
  expect(path).toBe(
    "/var/serfs/flows/incidents/jobs/INC-1/runs/0/logs/investigate-copilot-gpt-5.2.log",
  )
})

test("agentLogPath sanitizes filesystem-unsafe chars in model names", () => {
  const path = agentLogPath("f", "j", 0, "step", "p", "claude/sonnet:latest", "/s")
  expect(path).toBe("/s/flows/f/jobs/j/runs/0/logs/step-p-claude_sonnet_latest.log")
})

test("jobDir encodes filesystem-unsafe id segments", () => {
  expect(jobDir("flow/a", "job:b", "/s")).toBe("/s/flows/flow%2Fa/jobs/job%3Ab")
})
