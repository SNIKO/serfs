import type { z } from "zod"

export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped"

export type StepStatus = "pending" | "running" | "done" | "failed"

export interface AgentState {
  provider: string
  model: string
  tokens: { input: number; output: number }
  costUsd?: number
  toolCalls: number
  logPath: string
}

export interface StepState {
  name: string
  status: StepStatus
  startedAt?: number
  endedAt?: number
  error?: string
  agent?: AgentState
}

export interface RunState {
  runId: number
  startedAt: number
  endedAt?: number
  steps: StepState[]
}

export interface JobState {
  jobId: string
  flowId: string
  status: JobStatus
  startedAt: number
  endedAt?: number
  error?: string
  totals: {
    tokens: { input: number; output: number }
    costUsd?: number
  }
  runs: RunState[]
}

export interface AgentStepOptions<T> {
  stepId?: string
  provider?: string
  model?: string
  schema?: z.ZodSchema<T>
  vars?: Record<string, string>
}

export interface JobContext {
  jobId: string
  flowId: string
  runId: number
  workspaceDir: string
  jobDir: string
  state: JobState

  step(name: string, fn: () => Promise<void>): Promise<void>
  agent<T = string>(promptTemplate: string, options?: AgentStepOptions<T>): Promise<T>
}
