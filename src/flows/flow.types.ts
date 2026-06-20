import type { JobContext, JobState } from "../jobs/index.ts"

export interface FlowConfig {
  enabled?: boolean
  maxConcurrentJobs?: number
  workspaceDir?: string
  pollIntervalMs?: number
}

export interface Flow<TJob = unknown> {
  readonly id: string
  readonly config: FlowConfig

  fetchJobs(): Promise<TJob[]>
  getJobId(job: TJob): string
  isRunnable(job: TJob, history: JobState | null): Promise<boolean>
  run(job: TJob, ctx: JobContext): Promise<void>
}
