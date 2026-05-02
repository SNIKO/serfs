import type { AgentEvent } from "../agents/index.ts"
import type { JobStatus } from "../jobs/job.types.ts"

export interface JobQueuedEvent {
  type: "job.queued"
  flowId: string
  jobId: string
  at: number
}

export interface JobRemovedEvent {
  type: "job.removed"
  flowId: string
  jobId: string
  at: number
  reason: "not-runnable"
}

export interface JobStartEvent {
  type: "job.start"
  flowId: string
  jobId: string
  runId: number
  at: number
}

export interface JobEndEvent {
  type: "job.end"
  flowId: string
  jobId: string
  runId: number
  at: number
  status: JobStatus
  error?: string
}

export interface StepStartEvent {
  type: "step.start"
  flowId: string
  jobId: string
  runId: number
  step: string
  at: number
}

export interface StepEndEvent {
  type: "step.end"
  flowId: string
  jobId: string
  runId: number
  step: string
  at: number
  status: "done" | "failed"
  error?: string
}

export interface AgentEventEnvelope {
  type: "agent.event"
  flowId: string
  jobId: string
  runId: number
  step: string
  provider: string
  model: string
  event: AgentEvent
}

export type SerfsEvent =
  | JobQueuedEvent
  | JobRemovedEvent
  | JobStartEvent
  | JobEndEvent
  | StepStartEvent
  | StepEndEvent
  | AgentEventEnvelope

export type SerfsEventType = SerfsEvent["type"]
