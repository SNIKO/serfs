import { readFile } from "node:fs/promises"
import type { FlowRegistry } from "../flows/index.ts"
import type { JobQueue } from "../jobs/index.ts"
import { agentLogPath, jobDir as buildJobDir, loadState } from "../state/index.ts"

export interface DashboardDeps {
  registry: FlowRegistry
  queue: JobQueue<unknown>
  stateDir: string
}

export interface DashboardRequest {
  method: string
  path: string
  query: Record<string, string>
}

export async function handleApi(
  req: DashboardRequest,
  deps: DashboardDeps,
): Promise<Response | null> {
  const { method, path } = req

  if (method === "GET" && path === "/api/flows") {
    return json(deps.registry.list().map((f) => ({ id: f.id, config: f.config })))
  }

  const flowsList = path.match(/^\/api\/flows\/([^/]+)\/jobs$/)
  if (method === "GET" && flowsList) {
    return json({
      flowId: flowsList[1],
      note: "listing requires walking stateDir; v1 returns []",
      jobs: [],
    })
  }

  const detail = path.match(/^\/api\/flows\/([^/]+)\/jobs\/([^/]+)$/)
  if (method === "GET" && detail) {
    const [, flowId, jobId] = detail
    const state = await loadState(buildJobDir(deps.stateDir, flowId, jobId))
    if (!state) return notFound()
    return json(state)
  }

  const stop = path.match(/^\/api\/flows\/([^/]+)\/jobs\/([^/]+)\/stop$/)
  if (method === "POST" && stop) {
    const [, flowId, jobId] = stop
    deps.queue.stop(flowId, jobId)
    return new Response(null, { status: 204 })
  }

  const logRoute = path.match(
    /^\/api\/flows\/([^/]+)\/jobs\/([^/]+)\/runs\/(\d+)\/steps\/([^/]+)\/log$/,
  )
  if (method === "GET" && logRoute) {
    const [, flowId, jobId, runIdStr, step] = logRoute
    const state = await loadState(buildJobDir(deps.stateDir, flowId, jobId))
    if (!state) return notFound()
    const runId = Number(runIdStr)
    const stepState = state.runs[runId]?.steps.find((s) => s.name === step)
    if (!stepState?.agent) return notFound()
    const fullPath = agentLogPath(
      deps.stateDir,
      flowId,
      jobId,
      runId,
      step,
      stepState.agent.provider,
      stepState.agent.model,
    )
    try {
      const contents = await readFile(fullPath, "utf8")
      return new Response(contents, { headers: { "content-type": "application/x-ndjson" } })
    } catch {
      return notFound()
    }
  }

  return null
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

function notFound(): Response {
  return new Response("not found", { status: 404 })
}
