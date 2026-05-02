import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
import type { EventBus } from "../events/index.ts"
import { type DashboardDeps, handleApi } from "./dashboard-api.ts"
import { createSseStream } from "./dashboard-events.ts"

export interface DashboardHandle {
  port: number
  stop(): Promise<void>
}

export interface StartDashboardArgs extends DashboardDeps {
  port: number
  host: string
  events: EventBus
}

const SPA_DIR = new URL("./spa/", import.meta.url).pathname

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
}

export function startDashboard(args: StartDashboardArgs): DashboardHandle {
  const server = Bun.serve({
    port: args.port,
    hostname: args.host,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname
      const query = Object.fromEntries(url.searchParams.entries())

      if (path === "/api/events") {
        return createSseStream({ events: args.events })
      }

      if (path.startsWith("/api/")) {
        const handled = await handleApi({ method: req.method, path, query }, args)
        if (handled) return handled
        return new Response("not found", { status: 404 })
      }

      return serveStatic(path)
    },
  })

  return {
    port: server.port ?? args.port,
    async stop() {
      server.stop(true)
    },
  }
}

async function serveStatic(path: string): Promise<Response> {
  const safe = path === "/" ? "index.html" : path.replace(/^\/+/, "")
  if (safe.includes("..")) return new Response("forbidden", { status: 403 })

  const full = join(SPA_DIR, safe)
  try {
    const data = await readFile(full)
    const type = MIME[extname(full)] ?? "application/octet-stream"
    return new Response(data, { headers: { "content-type": type } })
  } catch {
    return new Response("not found", { status: 404 })
  }
}
