import type { Flow } from "./flow.types.ts"

export interface FlowRegistry {
  register<T>(flow: Flow<T>): void
  get(id: string): Flow<unknown> | undefined
  list(): Flow<unknown>[]
}

export function createFlowRegistry(): FlowRegistry {
  const flows = new Map<string, Flow<unknown>>()

  return {
    register<T>(flow: Flow<T>) {
      if (flows.has(flow.id)) {
        throw new Error(`Duplicate flow id: ${flow.id}`)
      }
      flows.set(flow.id, flow as Flow<unknown>)
    },
    get(id) {
      return flows.get(id)
    },
    list() {
      return [...flows.values()]
    },
  }
}
