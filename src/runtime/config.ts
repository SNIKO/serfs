import type { Flow } from "../flows/index.ts"

export interface SerfsConfigInput {
  maxConcurrentJobs: number
  flows: Flow[]
  dashboard?: { enabled?: boolean; port?: number; host?: string }
}

export interface SerfsConfig {
  maxConcurrentJobs: number
  flows: Flow[]
  dashboard: { enabled: boolean; port: number; host: string }
}

export const DEFAULT_DASHBOARD_PORT = 4000
export const DEFAULT_DASHBOARD_HOST = "127.0.0.1"

export function validateConfig(input: SerfsConfigInput): SerfsConfig {
  if (!Number.isInteger(input.maxConcurrentJobs) || input.maxConcurrentJobs < 1) {
    throw new Error("Serfs config: maxConcurrentJobs must be a positive integer")
  }
  if (!Array.isArray(input.flows) || input.flows.length === 0) {
    throw new Error("Serfs config: at least one flow is required")
  }

  const ids = new Set<string>()
  for (const flow of input.flows) {
    if (!flow.id) throw new Error("Serfs config: flow.id is required")
    if (ids.has(flow.id)) throw new Error(`Serfs config: duplicate flow id "${flow.id}"`)
    ids.add(flow.id)
  }

  return {
    maxConcurrentJobs: input.maxConcurrentJobs,
    flows: input.flows,
    dashboard: {
      enabled: input.dashboard?.enabled ?? true,
      port: input.dashboard?.port ?? DEFAULT_DASHBOARD_PORT,
      host: input.dashboard?.host ?? DEFAULT_DASHBOARD_HOST,
    },
  }
}
