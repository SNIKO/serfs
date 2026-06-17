# Serfs Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time read-only operator dashboard (+ stop-job action) served from the existing Bun HTTP server on port 4000.

**Architecture:** A Vite + React 18 SPA consumes a single SSE endpoint (`GET /api/events`) and builds all state in-browser via an immutable reducer. Views are conditionally rendered — no routing library. The Bun server serves the built SPA assets from `src/dashboard/spa/dist/` (dev) or `dist/dashboard/spa/dist/` (prod); it also provides `GET /api/flows` for the initial flows list.

**Tech Stack:** React 18, TypeScript, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), `bun:test` for unit tests on pure functions.

---

## File Map

**Modified:**
- `src/dashboard/dashboard-server.ts` — update `SPA_DIR` to `./spa/dist/`, add SPA 404→index.html fallback
- `src/dashboard/spa/index.html` — replace placeholder with Vite-compatible entry point
- `package.json` — add `build:spa`, `dev:spa` scripts; update main `build` to include SPA; add SPA devDependencies

**Created:**
- `src/dashboard/spa/vite.config.ts` — Vite config (React plugin, Tailwind plugin, dev proxy to port 4000)
- `src/dashboard/spa/tsconfig.json` — SPA-specific TS config (JSX, DOM lib, no Bun types)
- `src/dashboard/spa/src/styles.css` — Tailwind base import + CSS custom properties
- `src/dashboard/spa/src/types.ts` — all dashboard state types
- `src/dashboard/spa/src/lib/state-reducer.ts` — pure event → state reducer (+ `applyAgentEvent`)
- `src/dashboard/spa/src/lib/state-reducer.test.ts` — tests for every event type
- `src/dashboard/spa/src/lib/formatters.ts` — `formatTokens`, `formatCost`, `formatDuration`
- `src/dashboard/spa/src/lib/formatters.test.ts` — unit tests
- `src/dashboard/spa/src/hooks/use-event-stream.ts` — SSE connection + `useReducer` wiring
- `src/dashboard/spa/src/main.tsx` — React root mount
- `src/dashboard/spa/src/app.tsx` — layout (sidebar + main), view state, localStorage nav
- `src/dashboard/spa/src/components/ui/status-pill.tsx` — coloured status badge
- `src/dashboard/spa/src/components/ui/duration.tsx` — live-updating elapsed timer
- `src/dashboard/spa/src/components/sidebar.tsx` — flow list + agents nav link
- `src/dashboard/spa/src/components/jobs-view.tsx` — jobs grid with filtering
- `src/dashboard/spa/src/components/job-detail-view.tsx` — header, runs, steps list
- `src/dashboard/spa/src/components/agent-event-log.tsx` — per-step chronological event log
- `src/dashboard/spa/src/components/agents-view.tsx` — active agents grid

---

## Task 1: Build Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `src/dashboard/dashboard-server.ts`
- Modify: `src/dashboard/spa/index.html`
- Create: `src/dashboard/spa/vite.config.ts`
- Create: `src/dashboard/spa/tsconfig.json`
- Create: `src/dashboard/spa/src/styles.css`

- [ ] **Step 1: Install SPA dependencies**

Run:
```bash
bun add -d vite @vitejs/plugin-react @tailwindcss/vite react react-dom
bun add -d @types/react @types/react-dom
```

Expected: `package.json` updated with new devDependencies, `bun.lock` updated.

- [ ] **Step 2: Create Vite config**

Create `src/dashboard/spa/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
})
```

- [ ] **Step 3: Create SPA tsconfig**

Create `src/dashboard/spa/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Update index.html for Vite**

Replace `src/dashboard/spa/index.html` with:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Serfs</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create base CSS file**

Create `src/dashboard/spa/src/styles.css`:
```css
@import "tailwindcss";

@theme {
  --color-status-queued: var(--color-zinc-400);
  --color-status-running: var(--color-blue-400);
  --color-status-done: var(--color-green-400);
  --color-status-failed: var(--color-red-400);
  --color-status-stopped: var(--color-orange-400);
}
```

- [ ] **Step 6: Add build scripts to package.json**

In `package.json` scripts section, add/update:
```json
"dev:spa": "cd src/dashboard/spa && bunx vite",
"build:spa": "cd src/dashboard/spa && bunx vite build",
"build": "bun run build:spa && bun build src/index.ts --outdir dist --target node --packages external && tsc -p tsconfig.build.json && mkdir -p dist/dashboard/spa && cp -r src/dashboard/spa/dist dist/dashboard/spa/dist"
```

- [ ] **Step 7: Update dashboard-server.ts SPA_DIR and add SPA fallback**

In `src/dashboard/dashboard-server.ts`, change `SPA_DIR` line and `serveStatic` function:
```ts
const SPA_DIR = new URL("./spa/dist/", import.meta.url).pathname

async function serveStatic(path: string): Promise<Response> {
  const safe = path === "/" ? "index.html" : path.replace(/^\/+/, "")
  if (safe.includes("..")) return new Response("forbidden", { status: 403 })

  const full = join(SPA_DIR, safe)
  try {
    const data = await readFile(full)
    const type = MIME[extname(full)] ?? "application/octet-stream"
    return new Response(data, { headers: { "content-type": type } })
  } catch {
    try {
      const data = await readFile(join(SPA_DIR, "index.html"))
      return new Response(data, { headers: { "content-type": "text/html" } })
    } catch {
      return new Response("not found", { status: 404 })
    }
  }
}
```

- [ ] **Step 8: Verify build works**

Run:
```bash
bun run build:spa
```

Expected: `src/dashboard/spa/dist/` created with `index.html` and `assets/` directory containing `.js` and `.css` files. No TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/spa/ src/dashboard/dashboard-server.ts package.json bun.lock
git commit -m "feat(dashboard): set up Vite + React + Tailwind build infrastructure"
```

---

## Task 2: State Types

**Files:**
- Create: `src/dashboard/spa/src/types.ts`

No tests needed — these are type definitions only.

- [ ] **Step 1: Create types.ts**

Create `src/dashboard/spa/src/types.ts`:
```ts
export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped"
export type StepStatus = "pending" | "running" | "done" | "failed"
export type ToolType = "shell" | "file" | "mcp" | "web" | "other"
export type ConnectionStatus = "connecting" | "connected" | "disconnected"

export interface AgentStats {
  tokens?: {
    input?: number
    output?: number
    total?: number
    cachedInput?: number
    reasoningOutput?: number
  }
  context?: {
    contextSize?: number
    usedTokens?: number
  }
  toolCalls?: number
  costUsd?: number
  durationMs?: number
}

export interface ToolCallState {
  toolId: string
  toolType: ToolType
  startedDetails: unknown
  progress: string[]
  completed?: { success: boolean; details: unknown }
}

export interface MessageState {
  messageId: string
  content: string
  streaming: boolean
}

export interface ReasoningState {
  content: string
  streaming: boolean
}

export type AgentEventRecord =
  | { type: "message.delta"; data: { messageId: string; delta: string }; timestamp: number }
  | { type: "message.completed"; data: { messageId: string; content: string }; timestamp: number }
  | { type: "reasoning.delta"; data: { delta: string }; timestamp: number }
  | { type: "reasoning.completed"; data: { content: string }; timestamp: number }
  | { type: "tool.started"; data: { toolId: string; toolType: ToolType; details: unknown }; timestamp: number }
  | { type: "tool.progress"; data: { toolId: string; message: string; details?: unknown }; timestamp: number }
  | { type: "tool.completed"; data: { toolId: string; toolType: ToolType; success: boolean; details: unknown }; timestamp: number }
  | { type: "stats.updated"; data: AgentStats; timestamp: number }
  | { type: "error"; data: { code: string; message: string; recoverable: boolean }; timestamp: number }
  | { type: "raw"; data: unknown; timestamp: number }

export interface AgentInvocationState {
  provider: string
  model: string
  stats: AgentStats
  messages: Record<string, MessageState>
  toolCalls: Record<string, ToolCallState>
  reasoning?: ReasoningState
  /** Ordered list of event types for rendering the log in sequence */
  eventLog: AgentEventRecord[]
}

export interface StepState {
  name: string
  status: StepStatus
  startedAt?: number
  endedAt?: number
  error?: string
  agent?: AgentInvocationState
}

export interface RunState {
  runId: number
  startedAt: number
  endedAt?: number
  steps: StepState[]
}

export interface JobTotals {
  tokens: { input: number; output: number }
  costUsd?: number
}

export interface JobState {
  jobId: string
  flowId: string
  status: JobStatus
  queuedAt?: number
  startedAt?: number
  endedAt?: number
  error?: string
  totals: JobTotals
  runs: RunState[]
}

export interface FlowState {
  id: string
  jobs: Record<string, JobState>
}

export interface DashboardState {
  flows: Record<string, FlowState>
  connection: ConnectionStatus
}

// Events from the server SSE stream
export type SerfsStreamEvent =
  | { type: "job.queued"; flowId: string; jobId: string; at: number }
  | { type: "job.removed"; flowId: string; jobId: string; at: number; reason: string }
  | { type: "job.start"; flowId: string; jobId: string; runId: number; at: number }
  | { type: "job.end"; flowId: string; jobId: string; runId: number; at: number; status: "done" | "failed" | "stopped"; error?: string }
  | { type: "step.start"; flowId: string; jobId: string; runId: number; step: string; at: number }
  | { type: "step.end"; flowId: string; jobId: string; runId: number; step: string; at: number; status: "done" | "failed"; error?: string }
  | { type: "agent.event"; flowId: string; jobId: string; runId: number; step: string; provider: string; model: string; event: AgentEventRecord }

export const INITIAL_STATE: DashboardState = {
  flows: {},
  connection: "connecting",
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `src/dashboard/spa/`:
```bash
bunx tsc --noEmit
```

Expected: No errors. (Note: run this from the `src/dashboard/spa/` directory so it uses the SPA tsconfig.)

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/spa/src/types.ts
git commit -m "feat(dashboard): add SPA state type definitions"
```

---

## Task 3: State Reducer

**Files:**
- Create: `src/dashboard/spa/src/lib/state-reducer.ts`
- Create: `src/dashboard/spa/src/lib/state-reducer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard/spa/src/lib/state-reducer.test.ts`:
```ts
import { expect, test, describe } from "bun:test"
import { reduce } from "./state-reducer"
import { INITIAL_STATE, type DashboardState } from "../types"

describe("job.queued", () => {
  test("creates flow and job", () => {
    const state = reduce(INITIAL_STATE, {
      type: "job.queued",
      flowId: "f1",
      jobId: "j1",
      at: 1000,
    })
    expect(state.flows["f1"]).toBeDefined()
    expect(state.flows["f1"].jobs["j1"].status).toBe("queued")
    expect(state.flows["f1"].jobs["j1"].queuedAt).toBe(1000)
    expect(state.flows["f1"].jobs["j1"].totals.tokens).toEqual({ input: 0, output: 0 })
  })

  test("adds job to existing flow without clobbering other jobs", () => {
    const s1 = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    const s2 = reduce(s1, { type: "job.queued", flowId: "f1", jobId: "j2", at: 2000 })
    expect(Object.keys(s2.flows["f1"].jobs)).toHaveLength(2)
  })
})

describe("job.removed", () => {
  test("removes existing job", () => {
    const s1 = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    const s2 = reduce(s1, { type: "job.removed", flowId: "f1", jobId: "j1", at: 1001, reason: "not-runnable" })
    expect(s2.flows["f1"].jobs["j1"]).toBeUndefined()
  })

  test("no-ops for unknown job", () => {
    const s = reduce(INITIAL_STATE, { type: "job.removed", flowId: "f1", jobId: "j1", at: 1000, reason: "not-runnable" })
    expect(s).toBe(INITIAL_STATE)
  })
})

describe("job.start", () => {
  test("sets status to running and creates run", () => {
    const s1 = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    const s2 = reduce(s1, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    const job = s2.flows["f1"].jobs["j1"]
    expect(job.status).toBe("running")
    expect(job.startedAt).toBe(2000)
    expect(job.runs).toHaveLength(1)
    expect(job.runs[0].runId).toBe(0)
    expect(job.runs[0].startedAt).toBe(2000)
    expect(job.runs[0].steps).toHaveLength(0)
  })
})

describe("job.end", () => {
  test("sets terminal status and endedAt", () => {
    const s1 = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    const s2 = reduce(s1, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    const s3 = reduce(s2, { type: "job.end", flowId: "f1", jobId: "j1", runId: 0, at: 5000, status: "done" })
    const job = s3.flows["f1"].jobs["j1"]
    expect(job.status).toBe("done")
    expect(job.endedAt).toBe(5000)
    expect(job.error).toBeUndefined()
  })

  test("stores error on failed status", () => {
    const s1 = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    const s2 = reduce(s1, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    const s3 = reduce(s2, { type: "job.end", flowId: "f1", jobId: "j1", runId: 0, at: 5000, status: "failed", error: "boom" })
    expect(s3.flows["f1"].jobs["j1"].error).toBe("boom")
  })
})

describe("step.start", () => {
  test("adds step to run with running status", () => {
    const s1 = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    const s2 = reduce(s1, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    const s3 = reduce(s2, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "fetch", at: 2100 })
    const step = s3.flows["f1"].jobs["j1"].runs[0].steps[0]
    expect(step.name).toBe("fetch")
    expect(step.status).toBe("running")
    expect(step.startedAt).toBe(2100)
  })
})

describe("step.end", () => {
  test("transitions step to done", () => {
    let s = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    s = reduce(s, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    s = reduce(s, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "fetch", at: 2100 })
    s = reduce(s, { type: "step.end", flowId: "f1", jobId: "j1", runId: 0, step: "fetch", at: 3000, status: "done" })
    const step = s.flows["f1"].jobs["j1"].runs[0].steps[0]
    expect(step.status).toBe("done")
    expect(step.endedAt).toBe(3000)
  })
})

describe("agent.event — message.delta", () => {
  test("appends delta to streaming message", () => {
    let s = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    s = reduce(s, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    s = reduce(s, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "analyze", at: 2100 })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "analyze",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "message.delta", data: { messageId: "m1", delta: "Hello" }, timestamp: 2200 },
    })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "analyze",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "message.delta", data: { messageId: "m1", delta: " world" }, timestamp: 2201 },
    })
    const agent = s.flows["f1"].jobs["j1"].runs[0].steps[0].agent!
    expect(agent.messages["m1"].content).toBe("Hello world")
    expect(agent.messages["m1"].streaming).toBe(true)
    expect(agent.provider).toBe("anthropic")
  })
})

describe("agent.event — message.completed", () => {
  test("sets final content and streaming=false", () => {
    let s = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    s = reduce(s, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    s = reduce(s, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "analyze", at: 2100 })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "analyze",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "message.delta", data: { messageId: "m1", delta: "partial" }, timestamp: 2200 },
    })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "analyze",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "message.completed", data: { messageId: "m1", content: "final" }, timestamp: 2300 },
    })
    const msg = s.flows["f1"].jobs["j1"].runs[0].steps[0].agent!.messages["m1"]
    expect(msg.content).toBe("final")
    expect(msg.streaming).toBe(false)
  })
})

describe("agent.event — tool.started / tool.progress / tool.completed", () => {
  test("creates tool call row and appends progress, then marks completed", () => {
    let s = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    s = reduce(s, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    s = reduce(s, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "run", at: 2100 })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "run",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "tool.started", data: { toolId: "t1", toolType: "shell", details: { command: "npm test" } }, timestamp: 2200 },
    })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "run",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "tool.progress", data: { toolId: "t1", message: "running..." }, timestamp: 2201 },
    })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "run",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "tool.completed", data: { toolId: "t1", toolType: "shell", success: true, details: { command: "npm test", exitCode: 0 } }, timestamp: 2300 },
    })
    const tool = s.flows["f1"].jobs["j1"].runs[0].steps[0].agent!.toolCalls["t1"]
    expect(tool.toolType).toBe("shell")
    expect(tool.progress).toHaveLength(1)
    expect(tool.progress[0]).toBe("running...")
    expect(tool.completed?.success).toBe(true)
  })
})

describe("agent.event — stats.updated", () => {
  test("updates agent stats", () => {
    let s = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    s = reduce(s, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    s = reduce(s, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "run", at: 2100 })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "run",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "stats.updated", data: { tokens: { input: 500, output: 200 }, costUsd: 0.0012 }, timestamp: 2200 },
    })
    const stats = s.flows["f1"].jobs["j1"].runs[0].steps[0].agent!.stats
    expect(stats.tokens?.input).toBe(500)
    expect(stats.costUsd).toBe(0.0012)
  })
})

describe("agent.event — reasoning", () => {
  test("appends reasoning delta, then sets final on completed", () => {
    let s = reduce(INITIAL_STATE, { type: "job.queued", flowId: "f1", jobId: "j1", at: 1000 })
    s = reduce(s, { type: "job.start", flowId: "f1", jobId: "j1", runId: 0, at: 2000 })
    s = reduce(s, { type: "step.start", flowId: "f1", jobId: "j1", runId: 0, step: "think", at: 2100 })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "think",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "reasoning.delta", data: { delta: "let me" }, timestamp: 2200 },
    })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "think",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "reasoning.delta", data: { delta: " think" }, timestamp: 2201 },
    })
    s = reduce(s, {
      type: "agent.event",
      flowId: "f1", jobId: "j1", runId: 0, step: "think",
      provider: "anthropic", model: "claude-opus-4-5",
      event: { type: "reasoning.completed", data: { content: "let me think carefully" }, timestamp: 2300 },
    })
    const agent = s.flows["f1"].jobs["j1"].runs[0].steps[0].agent!
    expect(agent.reasoning?.content).toBe("let me think carefully")
    expect(agent.reasoning?.streaming).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
bun test src/dashboard/spa/src/lib/state-reducer.test.ts
```

Expected: FAIL — `Cannot find module "./state-reducer"`

- [ ] **Step 3: Implement state-reducer.ts**

Create `src/dashboard/spa/src/lib/state-reducer.ts`:
```ts
import type {
  AgentEventRecord,
  AgentInvocationState,
  AgentStats,
  DashboardState,
  JobState,
  RunState,
  SerfsStreamEvent,
  StepState,
  ToolType,
} from "../types"

// ── helpers ──────────────────────────────────────────────────────────────────

function getOrCreateFlow(
  flows: DashboardState["flows"],
  flowId: string,
): DashboardState["flows"][string] {
  return flows[flowId] ?? { id: flowId, jobs: {} }
}

function updateJob(
  state: DashboardState,
  flowId: string,
  jobId: string,
  fn: (job: JobState) => JobState,
): DashboardState {
  const flow = state.flows[flowId]
  if (!flow) return state
  const job = flow.jobs[jobId]
  if (!job) return state
  return {
    ...state,
    flows: {
      ...state.flows,
      [flowId]: { ...flow, jobs: { ...flow.jobs, [jobId]: fn(job) } },
    },
  }
}

function updateStep(
  state: DashboardState,
  flowId: string,
  jobId: string,
  runId: number,
  stepName: string,
  fn: (step: StepState) => StepState,
): DashboardState {
  return updateJob(state, flowId, jobId, (job) => {
    const run = job.runs[runId]
    if (!run) return job
    const idx = run.steps.findIndex((s) => s.name === stepName)
    if (idx === -1) return job
    const steps = [...run.steps]
    steps[idx] = fn(steps[idx])
    const runs = [...job.runs]
    runs[runId] = { ...run, steps }
    return { ...job, runs }
  })
}

function updateRun(
  state: DashboardState,
  flowId: string,
  jobId: string,
  runId: number,
  fn: (run: RunState) => RunState,
): DashboardState {
  return updateJob(state, flowId, jobId, (job) => {
    const run = job.runs[runId]
    if (!run) return job
    const runs = [...job.runs]
    runs[runId] = fn(run)
    return { ...job, runs }
  })
}

// ── agent event handler ───────────────────────────────────────────────────────

function applyAgentEvent(
  agent: AgentInvocationState,
  event: AgentEventRecord,
): AgentInvocationState {
  const eventLog = [...agent.eventLog, event]
  switch (event.type) {
    case "message.delta": {
      const existing = agent.messages[event.data.messageId]
      return {
        ...agent,
        eventLog,
        messages: {
          ...agent.messages,
          [event.data.messageId]: {
            messageId: event.data.messageId,
            content: (existing?.content ?? "") + event.data.delta,
            streaming: true,
          },
        },
      }
    }
    case "message.completed": {
      return {
        ...agent,
        eventLog,
        messages: {
          ...agent.messages,
          [event.data.messageId]: {
            messageId: event.data.messageId,
            content: event.data.content,
            streaming: false,
          },
        },
      }
    }
    case "reasoning.delta": {
      return {
        ...agent,
        eventLog,
        reasoning: {
          content: (agent.reasoning?.content ?? "") + event.data.delta,
          streaming: true,
        },
      }
    }
    case "reasoning.completed": {
      return {
        ...agent,
        eventLog,
        reasoning: { content: event.data.content, streaming: false },
      }
    }
    case "tool.started": {
      return {
        ...agent,
        eventLog,
        toolCalls: {
          ...agent.toolCalls,
          [event.data.toolId]: {
            toolId: event.data.toolId,
            toolType: event.data.toolType as ToolType,
            startedDetails: event.data.details,
            progress: [],
          },
        },
      }
    }
    case "tool.progress": {
      const existing = agent.toolCalls[event.data.toolId]
      if (!existing) return { ...agent, eventLog }
      return {
        ...agent,
        eventLog,
        toolCalls: {
          ...agent.toolCalls,
          [event.data.toolId]: {
            ...existing,
            progress: [...existing.progress, event.data.message],
          },
        },
      }
    }
    case "tool.completed": {
      const existing = agent.toolCalls[event.data.toolId]
      if (!existing) return { ...agent, eventLog }
      return {
        ...agent,
        eventLog,
        toolCalls: {
          ...agent.toolCalls,
          [event.data.toolId]: {
            ...existing,
            completed: { success: event.data.success, details: event.data.details },
          },
        },
      }
    }
    case "stats.updated": {
      return { ...agent, eventLog, stats: event.data as AgentStats }
    }
    default:
      return { ...agent, eventLog }
  }
}

function makeEmptyAgent(provider: string, model: string): AgentInvocationState {
  return {
    provider,
    model,
    stats: {},
    messages: {},
    toolCalls: {},
    eventLog: [],
  }
}

// ── main reducer ──────────────────────────────────────────────────────────────

export function reduce(state: DashboardState, event: SerfsStreamEvent): DashboardState {
  switch (event.type) {
    case "job.queued": {
      const flow = getOrCreateFlow(state.flows, event.flowId)
      return {
        ...state,
        flows: {
          ...state.flows,
          [event.flowId]: {
            ...flow,
            jobs: {
              ...flow.jobs,
              [event.jobId]: {
                jobId: event.jobId,
                flowId: event.flowId,
                status: "queued",
                queuedAt: event.at,
                totals: { tokens: { input: 0, output: 0 } },
                runs: [],
              },
            },
          },
        },
      }
    }

    case "job.removed": {
      const flow = state.flows[event.flowId]
      if (!flow?.jobs[event.jobId]) return state
      const jobs = { ...flow.jobs }
      delete jobs[event.jobId]
      return {
        ...state,
        flows: { ...state.flows, [event.flowId]: { ...flow, jobs } },
      }
    }

    case "job.start": {
      return updateJob(state, event.flowId, event.jobId, (job) => {
        const runs = [...job.runs]
        runs[event.runId] = { runId: event.runId, startedAt: event.at, steps: [] }
        return { ...job, status: "running", startedAt: event.at, runs }
      })
    }

    case "job.end": {
      return updateJob(state, event.flowId, event.jobId, (job) => {
        const runs = [...job.runs]
        if (runs[event.runId]) {
          runs[event.runId] = { ...runs[event.runId], endedAt: event.at }
        }
        return {
          ...job,
          status: event.status,
          endedAt: event.at,
          error: event.error,
          runs,
        }
      })
    }

    case "step.start": {
      return updateRun(state, event.flowId, event.jobId, event.runId, (run) => ({
        ...run,
        steps: [
          ...run.steps,
          { name: event.step, status: "running", startedAt: event.at },
        ],
      }))
    }

    case "step.end": {
      return updateStep(
        state,
        event.flowId,
        event.jobId,
        event.runId,
        event.step,
        (step) => ({
          ...step,
          status: event.status,
          endedAt: event.at,
          error: event.error,
        }),
      )
    }

    case "agent.event": {
      return updateStep(
        state,
        event.flowId,
        event.jobId,
        event.runId,
        event.step,
        (step) => {
          const agent =
            step.agent ?? makeEmptyAgent(event.provider, event.model)
          return { ...step, agent: applyAgentEvent(agent, event.event) }
        },
      )
    }

    default:
      return state
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
bun test src/dashboard/spa/src/lib/state-reducer.test.ts
```

Expected: All tests PASS. Green output.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/spa/src/lib/state-reducer.ts src/dashboard/spa/src/lib/state-reducer.test.ts
git commit -m "feat(dashboard): add event state reducer with full test coverage"
```

---

## Task 4: Formatters and UI Primitives

**Files:**
- Create: `src/dashboard/spa/src/lib/formatters.ts`
- Create: `src/dashboard/spa/src/lib/formatters.test.ts`
- Create: `src/dashboard/spa/src/components/ui/status-pill.tsx`
- Create: `src/dashboard/spa/src/components/ui/duration.tsx`

- [ ] **Step 1: Write failing formatter tests**

Create `src/dashboard/spa/src/lib/formatters.test.ts`:
```ts
import { expect, test } from "bun:test"
import { formatTokens, formatCost, formatDuration, describeActivity } from "./formatters"

test("formatTokens: < 1000", () => expect(formatTokens(500)).toBe("500"))
test("formatTokens: >= 1000", () => expect(formatTokens(1500)).toBe("1.5K"))
test("formatTokens: >= 1M", () => expect(formatTokens(2_100_000)).toBe("2.1M"))

test("formatCost: 4 decimal places with $ prefix", () => {
  expect(formatCost(0.0012)).toBe("$0.0012")
  expect(formatCost(1.23456)).toBe("$1.2346")
})
test("formatCost: undefined returns em-dash", () => expect(formatCost(undefined)).toBe("—"))

test("formatDuration: seconds only", () => expect(formatDuration(5_000)).toBe("5s"))
test("formatDuration: minutes and seconds", () => expect(formatDuration(125_000)).toBe("2m 5s"))
test("formatDuration: hours minutes seconds", () => expect(formatDuration(3_661_000)).toBe("1h 1m 1s"))

test("describeActivity: shell", () => {
  expect(describeActivity("shell", { command: "npm test" })).toBe("shell: npm test")
})
test("describeActivity: file", () => {
  expect(describeActivity("file", { operations: [{ path: "/foo/bar.ts", kind: "view" }] })).toBe("file: /foo/bar.ts")
})
test("describeActivity: mcp", () => {
  expect(describeActivity("mcp", { server: "db", tool: "query" })).toBe("mcp: db/query")
})
test("describeActivity: web search", () => {
  expect(describeActivity("web", { action: "search", query: "typescript" })).toBe("search: typescript")
})
test("describeActivity: web open", () => {
  expect(describeActivity("web", { action: "open", url: "https://example.com" })).toBe("open: https://example.com")
})
test("describeActivity: other", () => {
  expect(describeActivity("other", { name: "custom-tool" })).toBe("custom-tool")
})
```

- [ ] **Step 2: Run to confirm failures**

Run:
```bash
bun test src/dashboard/spa/src/lib/formatters.test.ts
```

Expected: FAIL — `Cannot find module "./formatters"`

- [ ] **Step 3: Implement formatters.ts**

Create `src/dashboard/spa/src/lib/formatters.ts`:
```ts
import type { ToolType } from "../types"

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—"
  return `$${usd.toFixed(4)}`
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function describeActivity(toolType: ToolType, details: unknown): string {
  const d = details as Record<string, unknown>
  switch (toolType) {
    case "shell":
      return `shell: ${d.command as string}`
    case "file": {
      const ops = d.operations as Array<{ path: string }>
      return `file: ${ops[0]?.path ?? "?"}`
    }
    case "mcp":
      return `mcp: ${d.server as string}/${d.tool as string}`
    case "web": {
      if (d.action === "search") return `search: ${d.query as string}`
      if (d.action === "open") return `open: ${d.url as string}`
      return "web"
    }
    default:
      return (d.name as string | undefined) ?? toolType
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
bun test src/dashboard/spa/src/lib/formatters.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Create StatusPill component**

Create `src/dashboard/spa/src/components/ui/status-pill.tsx`:
```tsx
import type { JobStatus, StepStatus } from "../../types"

const STYLES: Record<string, string> = {
  queued: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40",
  done: "bg-green-500/20 text-green-300",
  failed: "bg-red-500/20 text-red-300",
  stopped: "bg-orange-500/20 text-orange-300",
  pending: "bg-zinc-700/50 text-zinc-500",
}

interface Props {
  status: JobStatus | StepStatus
}

export function StatusPill({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-zinc-700 text-zinc-400"}`}
    >
      {status}
    </span>
  )
}
```

- [ ] **Step 6: Create Duration component**

Create `src/dashboard/spa/src/components/ui/duration.tsx`:
```tsx
import { useEffect, useState } from "react"
import { formatDuration } from "../../lib/formatters"

interface Props {
  startedAt: number
  endedAt?: number
  className?: string
}

export function Duration({ startedAt, endedAt, className }: Props) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (endedAt !== undefined) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endedAt])

  return (
    <span className={className}>
      {formatDuration((endedAt ?? now) - startedAt)}
    </span>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/spa/src/lib/formatters.ts src/dashboard/spa/src/lib/formatters.test.ts src/dashboard/spa/src/components/
git commit -m "feat(dashboard): add formatters, StatusPill, and Duration components"
```

---

## Task 5: App Shell and SSE Hook

**Files:**
- Create: `src/dashboard/spa/src/hooks/use-event-stream.ts`
- Create: `src/dashboard/spa/src/main.tsx`
- Create: `src/dashboard/spa/src/app.tsx`

- [ ] **Step 1: Create useEventStream hook**

Create `src/dashboard/spa/src/hooks/use-event-stream.ts`:
```ts
import { useEffect, useReducer } from "react"
import { INITIAL_STATE, type DashboardState, type FlowState, type SerfsStreamEvent } from "../types"
import { reduce } from "../lib/state-reducer"

type Action =
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "flows_loaded"; flows: Array<{ id: string }> }
  | { type: "server_event"; event: SerfsStreamEvent }

function rootReducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "connecting":
      return { ...state, connection: "connecting" }
    case "connected":
      return { ...state, connection: "connected" }
    case "disconnected":
      return { ...state, connection: "disconnected" }
    case "flows_loaded": {
      const flows: Record<string, FlowState> = { ...state.flows }
      for (const f of action.flows) {
        if (!flows[f.id]) flows[f.id] = { id: f.id, jobs: {} }
      }
      return { ...state, flows }
    }
    case "server_event":
      return reduce(state, action.event)
    default:
      return state
  }
}

export function useEventStream(): DashboardState {
  const [state, dispatch] = useReducer(rootReducer, INITIAL_STATE)

  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false

    dispatch({ type: "connecting" })

    fetch("/api/flows")
      .then((r) => r.json())
      .then((flows: Array<{ id: string }>) => {
        if (!cancelled) dispatch({ type: "flows_loaded", flows })
      })
      .catch(() => {})

    es = new EventSource("/api/events")

    es.onopen = () => {
      if (!cancelled) dispatch({ type: "connected" })
    }

    es.onmessage = (e: MessageEvent) => {
      if (cancelled) return
      try {
        const event = JSON.parse(e.data as string) as SerfsStreamEvent
        dispatch({ type: "server_event", event })
      } catch {}
    }

    es.onerror = () => {
      if (!cancelled) dispatch({ type: "disconnected" })
    }

    return () => {
      cancelled = true
      es?.close()
    }
  }, [])

  return state
}
```

- [ ] **Step 2: Create app.tsx**

Create `src/dashboard/spa/src/app.tsx`:
```tsx
import { useState, useEffect, createContext, useContext } from "react"
import { useEventStream } from "./hooks/use-event-stream"
import type { DashboardState } from "./types"
import { Sidebar } from "./components/sidebar"
import { JobsView } from "./components/jobs-view"
import { JobDetailView } from "./components/job-detail-view"
import { AgentsView } from "./components/agents-view"

export type View =
  | { type: "jobs"; flowId: string }
  | { type: "job-detail"; flowId: string; jobId: string }
  | { type: "agents" }

const STORAGE_KEY = "serfs-nav"

function loadView(): View | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as View | null
  } catch {
    return null
  }
}

const StateCtx = createContext<DashboardState>({ flows: {}, connection: "connecting" })
export const useAppState = () => useContext(StateCtx)

export function App() {
  const state = useEventStream()
  const [view, setView] = useState<View | null>(loadView)

  const navigate = (next: View) => {
    setView(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  useEffect(() => {
    if (view === null && Object.keys(state.flows).length > 0) {
      const firstFlow = Object.keys(state.flows)[0]
      navigate({ type: "jobs", flowId: firstFlow })
    }
  }, [state.flows, view])

  return (
    <StateCtx.Provider value={state}>
      <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
        <Sidebar view={view} navigate={navigate} />
        <main className="flex-1 overflow-auto">
          {view?.type === "agents" && <AgentsView navigate={navigate} />}
          {view?.type === "jobs" && (
            <JobsView flowId={view.flowId} navigate={navigate} />
          )}
          {view?.type === "job-detail" && (
            <JobDetailView
              flowId={view.flowId}
              jobId={view.jobId}
              navigate={navigate}
            />
          )}
          {!view && (
            <div className="flex items-center justify-center h-full text-zinc-500">
              Select a flow from the sidebar
            </div>
          )}
        </main>
      </div>
    </StateCtx.Provider>
  )
}
```

- [ ] **Step 3: Create main.tsx**

Create `src/dashboard/spa/src/main.tsx`:
```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { App } from "./app"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Create stub components so the build doesn't fail**

The `app.tsx` imports components that don't exist yet. Create minimal stubs:

Create `src/dashboard/spa/src/components/sidebar.tsx`:
```tsx
import type { View } from "../app"

interface Props {
  view: View | null
  navigate: (v: View) => void
}

export function Sidebar(_props: Props) {
  return <div>Sidebar stub</div>
}
```

Create `src/dashboard/spa/src/components/jobs-view.tsx`:
```tsx
import type { View } from "../app"

interface Props {
  flowId: string
  navigate: (v: View) => void
}

export function JobsView({ flowId }: Props) {
  return <div>Jobs for {flowId}</div>
}
```

Create `src/dashboard/spa/src/components/job-detail-view.tsx`:
```tsx
import type { View } from "../app"

interface Props {
  flowId: string
  jobId: string
  navigate: (v: View) => void
}

export function JobDetailView({ flowId, jobId }: Props) {
  return <div>Detail: {flowId}/{jobId}</div>
}
```

Create `src/dashboard/spa/src/components/agents-view.tsx`:
```tsx
import type { View } from "../app"

interface Props {
  navigate: (v: View) => void
}

export function AgentsView(_props: Props) {
  return <div>Agents stub</div>
}
```

- [ ] **Step 5: Verify SPA builds without errors**

Run:
```bash
bun run build:spa
```

Expected: Builds to `src/dashboard/spa/dist/` with no errors. TypeScript output shows 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/spa/src/
git commit -m "feat(dashboard): add app shell, SSE hook, and stub components"
```

---

## Task 6: Sidebar

**Files:**
- Modify: `src/dashboard/spa/src/components/sidebar.tsx` (replace stub)

- [ ] **Step 1: Implement sidebar**

Replace `src/dashboard/spa/src/components/sidebar.tsx` with:
```tsx
import { useAppState } from "../app"
import type { View } from "../app"

interface Props {
  view: View | null
  navigate: (v: View) => void
}

function countRunning(jobs: Record<string, { status: string }>): number {
  return Object.values(jobs).filter((j) => j.status === "running").length
}

function countActiveAgents(
  flows: Record<string, { jobs: Record<string, { runs: Array<{ steps: Array<{ status: string; agent?: unknown }> }> }> }>,
): number {
  let count = 0
  for (const flow of Object.values(flows)) {
    for (const job of Object.values(flow.jobs)) {
      for (const run of job.runs) {
        for (const step of run.steps) {
          if (step.status === "running" && step.agent) count++
        }
      }
    }
  }
  return count
}

export function Sidebar({ view, navigate }: Props) {
  const state = useAppState()
  const flows = Object.values(state.flows)
  const activeAgents = countActiveAgents(state.flows)

  const dot =
    state.connection === "connected"
      ? "bg-green-400"
      : state.connection === "disconnected"
        ? "bg-red-400"
        : "bg-yellow-400 animate-pulse"

  return (
    <aside className="w-56 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-sm font-semibold tracking-wide text-zinc-200">Serfs</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Flows section */}
        <div className="px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
            Flows
          </p>
          {flows.length === 0 && (
            <p className="text-xs text-zinc-600 px-1">No flows registered</p>
          )}
          {flows.map((flow) => {
            const running = countRunning(flow.jobs)
            const isActive = view?.type === "jobs" && view.flowId === flow.id
            return (
              <button
                key={flow.id}
                onClick={() => navigate({ type: "jobs", flowId: flow.id })}
                className={`w-full text-left flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                <span className="truncate">{flow.id}</span>
                {running > 0 && (
                  <span className="ml-1 flex-shrink-0 rounded-full bg-blue-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center">
                    {running}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Agents section */}
        <div className="px-3 py-1.5 mt-2">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
            Agents
          </p>
          <button
            onClick={() => navigate({ type: "agents" })}
            className={`w-full text-left flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors ${
              view?.type === "agents"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <span>All agents</span>
            {activeAgents > 0 && (
              <span className="ml-1 flex-shrink-0 rounded-full bg-blue-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center">
                {activeAgents}
              </span>
            )}
          </button>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Build and manually verify**

Run:
```bash
bun run build:spa
```

Then start the Bun server (`bun run dev`) and the Vite dev server (`bun run dev:spa`) in separate terminals. Open `http://localhost:5173`. Verify:
- Sidebar renders with "Serfs" title
- Connection dot is visible (yellow while connecting, green once SSE connects)
- Flows list is empty initially (no flows registered in dev)
- Clicking "All agents" navigates to agents view (stub text shows)

Expected: No console errors, sidebar layout looks correct.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/spa/src/components/sidebar.tsx
git commit -m "feat(dashboard): implement sidebar with flow list and agents nav"
```

---

## Task 7: Jobs View

**Files:**
- Modify: `src/dashboard/spa/src/components/jobs-view.tsx` (replace stub)

The jobs grid shows all jobs for a selected flow, with live-updating columns and status filtering.

- [ ] **Step 1: Implement jobs-view.tsx**

Replace `src/dashboard/spa/src/components/jobs-view.tsx` with:
```tsx
import { useState, useEffect } from "react"
import { useAppState, type View } from "../app"
import { StatusPill } from "./ui/status-pill"
import { Duration } from "./ui/duration"
import { formatTokens, formatCost, describeActivity } from "../lib/formatters"
import type { JobStatus, JobState, ToolType } from "../types"

const FILTER_KEY = "serfs-job-filter"

type FilterMode = "active" | "all"

interface Props {
  flowId: string
  navigate: (v: View) => void
}

function getActivity(job: JobState): string {
  const run = job.runs[job.runs.length - 1]
  if (!run) return ""
  const step = run.steps.find((s) => s.status === "running")
  if (!step?.agent) return ""
  const activeTool = Object.values(step.agent.toolCalls).find((t) => !t.completed)
  if (!activeTool) return ""
  return describeActivity(activeTool.toolType as ToolType, activeTool.startedDetails)
}

function getJobTokens(job: JobState): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const run of job.runs) {
    for (const step of run.steps) {
      input += step.agent?.stats.tokens?.input ?? 0
      output += step.agent?.stats.tokens?.output ?? 0
    }
  }
  return { input, output }
}

function getJobCost(job: JobState): number | undefined {
  let total = 0
  let hasAny = false
  for (const run of job.runs) {
    for (const step of run.steps) {
      const c = step.agent?.stats.costUsd
      if (c !== undefined) { total += c; hasAny = true }
    }
  }
  return hasAny ? total : undefined
}

function getCurrentStep(job: JobState): string {
  const run = job.runs[job.runs.length - 1]
  if (!run) return ""
  return run.steps.find((s) => s.status === "running")?.name ?? ""
}

function getCurrentAgent(job: JobState): string {
  const run = job.runs[job.runs.length - 1]
  if (!run) return ""
  const step = run.steps.find((s) => s.status === "running")
  if (!step?.agent) return ""
  return `${step.agent.provider} / ${step.agent.model}`
}

const ACTIVE_STATUSES: Set<JobStatus> = new Set(["queued", "running"])

export function JobsView({ flowId, navigate }: Props) {
  const state = useAppState()
  const flow = state.flows[flowId]
  const [filter, setFilter] = useState<FilterMode>(() => {
    return (localStorage.getItem(FILTER_KEY) as FilterMode | null) ?? "active"
  })
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, filter)
  }, [filter])

  if (!flow) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Flow not found
      </div>
    )
  }

  const allJobs = Object.values(flow.jobs)

  const activeJobs = allJobs.filter((j) => ACTIVE_STATUSES.has(j.status))
  const completedJobs = allJobs
    .filter((j) => !ACTIVE_STATUSES.has(j.status))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  const visibleCompleted = filter === "all"
    ? (showMore ? completedJobs : completedJobs.slice(0, 10))
    : []

  const rows = [...activeJobs, ...visibleCompleted]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-zinc-100">{flowId}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("active")}
            className={`text-xs px-3 py-1 rounded ${filter === "active" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`text-xs px-3 py-1 rounded ${filter === "all" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            All
          </button>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="text-zinc-500 text-sm">
          {filter === "active" ? "No active jobs." : "No jobs found."}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                <th className="pb-2 pr-4 font-medium">Job ID</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Step</th>
                <th className="pb-2 pr-4 font-medium">Agent</th>
                <th className="pb-2 pr-4 font-medium">Activity</th>
                <th className="pb-2 pr-4 font-medium text-right">Input</th>
                <th className="pb-2 pr-4 font-medium text-right">Output</th>
                <th className="pb-2 pr-4 font-medium text-right">Cost</th>
                <th className="pb-2 font-medium text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => {
                const tokens = getJobTokens(job)
                const cost = getJobCost(job)
                const activity = getActivity(job)
                return (
                  <tr
                    key={job.jobId}
                    onClick={() => navigate({ type: "job-detail", flowId, jobId: job.jobId })}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-mono text-xs text-zinc-300">{job.jobId}</td>
                    <td className="py-2.5 pr-4">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400 font-mono text-xs">
                      {getCurrentStep(job)}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400 text-xs max-w-[160px] truncate">
                      {getCurrentAgent(job)}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-500 text-xs max-w-[200px] truncate">
                      {activity}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-zinc-400 font-mono text-xs">
                      {formatTokens(tokens.input)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-zinc-400 font-mono text-xs">
                      {formatTokens(tokens.output)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-zinc-400 font-mono text-xs">
                      {formatCost(cost)}
                    </td>
                    <td className="py-2.5 text-right text-zinc-400 font-mono text-xs">
                      {job.startedAt ? (
                        <Duration startedAt={job.startedAt} endedAt={job.endedAt} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filter === "all" && completedJobs.length > 10 && !showMore && (
        <button
          onClick={() => setShowMore(true)}
          className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Show {completedJobs.length - 10} more…
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run:
```bash
bun run build:spa
```

Expected: No TypeScript errors.

Open `http://localhost:5173`, select a flow in the sidebar, verify the jobs table renders. Check that active/all filter buttons toggle correctly and filter state persists after page reload.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/spa/src/components/jobs-view.tsx
git commit -m "feat(dashboard): implement jobs grid view with filtering"
```

---

## Task 8: Job Detail View

**Files:**
- Modify: `src/dashboard/spa/src/components/job-detail-view.tsx` (replace stub)
- Create: `src/dashboard/spa/src/components/agent-event-log.tsx`

- [ ] **Step 1: Create agent-event-log.tsx stub (will be completed in Task 9)**

Create `src/dashboard/spa/src/components/agent-event-log.tsx`:
```tsx
import type { AgentInvocationState } from "../types"

interface Props {
  agent: AgentInvocationState
}

export function AgentEventLog({ agent }: Props) {
  return (
    <div className="font-mono text-xs text-zinc-400 space-y-1 px-4 py-2">
      {agent.eventLog.length === 0 && <span className="text-zinc-600">No events yet</span>}
      <span>{agent.eventLog.length} events</span>
    </div>
  )
}
```

- [ ] **Step 2: Implement job-detail-view.tsx**

Replace `src/dashboard/spa/src/components/job-detail-view.tsx` with:
```tsx
import { useState } from "react"
import { useAppState, type View } from "../app"
import { StatusPill } from "./ui/status-pill"
import { Duration } from "./ui/duration"
import { AgentEventLog } from "./agent-event-log"
import { formatTokens, formatCost } from "../lib/formatters"
import type { RunState, StepState } from "../types"

interface Props {
  flowId: string
  jobId: string
  navigate: (v: View) => void
}

function StepRow({ step, defaultExpanded }: { step: StepState; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isAgent = !!step.agent
  const isRunning = step.status === "running"

  const indicator =
    step.status === "running"
      ? <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
      : step.status === "done"
        ? <span className="text-green-400">✓</span>
        : step.status === "failed"
          ? <span className="text-red-400">✗</span>
          : <span className="text-zinc-600">○</span>

  return (
    <div className="border-b border-zinc-800/50 last:border-b-0">
      <div
        className={`flex items-center gap-3 px-4 py-2.5 ${isAgent ? "cursor-pointer hover:bg-zinc-800/30" : ""}`}
        onClick={() => isAgent && setExpanded((e) => !e)}
      >
        <span className="w-4 flex-shrink-0 text-center text-sm">{indicator}</span>
        <span className="font-mono text-sm text-zinc-300 flex-1">{step.name}</span>
        {step.agent && (
          <span className="text-xs text-zinc-500">
            {step.agent.provider}/{step.agent.model}
          </span>
        )}
        {isRunning && step.agent && (
          <span className="text-xs font-mono text-blue-300">
            ↑ {formatTokens(step.agent.stats.tokens?.input ?? 0)}{" "}
            ↓ {formatTokens(step.agent.stats.tokens?.output ?? 0)}
          </span>
        )}
        {!isRunning && step.startedAt && step.endedAt && (
          <Duration startedAt={step.startedAt} endedAt={step.endedAt} className="text-xs text-zinc-500" />
        )}
        {step.status === "failed" && step.error && (
          <span className="text-xs text-red-400 max-w-xs truncate">{step.error}</span>
        )}
        {isAgent && (
          <span className="text-zinc-600 text-xs">{expanded ? "▼" : "▶"}</span>
        )}
      </div>
      {isAgent && expanded && step.agent && (
        <div className="bg-zinc-950/60 border-t border-zinc-800/50">
          <AgentEventLog agent={step.agent} />
        </div>
      )}
    </div>
  )
}

function RunSection({
  run,
  isLatest,
}: {
  run: RunState
  isLatest: boolean
}) {
  const [open, setOpen] = useState(isLatest)

  return (
    <div className="mb-4 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800/60 transition-colors text-left"
      >
        <span className="text-xs text-zinc-500">{open ? "▼" : "▶"}</span>
        <span className="text-sm font-medium text-zinc-200">Run #{run.runId}</span>
        <span className="text-xs text-zinc-500 ml-auto">
          {new Date(run.startedAt).toLocaleTimeString()}
          {run.endedAt && (
            <> · <Duration startedAt={run.startedAt} endedAt={run.endedAt} /></>
          )}
          {!run.endedAt && (
            <> · <Duration startedAt={run.startedAt} /></>
          )}
        </span>
      </button>
      {open && (
        <div>
          {run.steps.length === 0 && (
            <p className="px-4 py-3 text-xs text-zinc-600">No steps yet</p>
          )}
          {run.steps.map((step) => (
            <StepRow
              key={step.name}
              step={step}
              defaultExpanded={step.status === "running"}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function JobDetailView({ flowId, jobId, navigate }: Props) {
  const state = useAppState()
  const job = state.flows[flowId]?.jobs[jobId]

  if (!job) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Job not found
      </div>
    )
  }

  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0
  for (const run of job.runs) {
    for (const step of run.steps) {
      totalInput += step.agent?.stats.tokens?.input ?? 0
      totalOutput += step.agent?.stats.tokens?.output ?? 0
      totalCost += step.agent?.stats.costUsd ?? 0
    }
  }

  const stopJob = async () => {
    await fetch(`/api/flows/${flowId}/jobs/${jobId}/stop`, { method: "POST" })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
        <button
          onClick={() => navigate({ type: "jobs", flowId })}
          className="hover:text-zinc-300 transition-colors"
        >
          ← {flowId}
        </button>
        <span>/</span>
        <span className="font-mono text-zinc-300">{jobId}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 pb-4 border-b border-zinc-800">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg text-zinc-100">{jobId}</span>
            <StatusPill status={job.status} />
          </div>
          <div className="flex items-center gap-4 text-sm font-mono text-zinc-400">
            <span>↑ {formatTokens(totalInput)}</span>
            <span>↓ {formatTokens(totalOutput)}</span>
            <span>{totalCost > 0 ? formatCost(totalCost) : "—"}</span>
            {job.startedAt && (
              <Duration startedAt={job.startedAt} endedAt={job.endedAt} />
            )}
          </div>
        </div>
        {job.status === "running" && (
          <button
            onClick={stopJob}
            className="text-xs px-3 py-1.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Stop job
          </button>
        )}
      </div>

      {/* Error banner */}
      {job.error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
          {job.error}
        </div>
      )}

      {/* Runs */}
      {job.runs.length === 0 && (
        <p className="text-zinc-500 text-sm">No runs yet</p>
      )}
      {job.runs.map((run, idx) => (
        <RunSection
          key={run.runId}
          run={run}
          isLatest={idx === job.runs.length - 1}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Build and verify**

```bash
bun run build:spa
```

Expected: No errors. Open a job detail view by clicking a job in the jobs grid. Verify:
- Breadcrumb shows `← flow-id / job-id`
- Header shows status pill, token counts, cost, duration
- Stop button appears for running jobs only
- Runs are listed; latest is expanded
- Steps show with correct indicators (○ pending, ● running, ✓ done, ✗ failed)
- Agent steps show expand/collapse arrow
- Clicking an agent step expands to show the event log stub

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/spa/src/components/job-detail-view.tsx src/dashboard/spa/src/components/agent-event-log.tsx
git commit -m "feat(dashboard): implement job detail view with runs, steps, and stop action"
```

---

## Task 9: Agent Event Log

**Files:**
- Modify: `src/dashboard/spa/src/components/agent-event-log.tsx` (replace stub)

This is the most complex component: a chronological, append-only log of agent events with streaming text, tool call rows keyed by `toolId`, auto-scroll, and a stats strip.

- [ ] **Step 1: Implement agent-event-log.tsx**

Replace `src/dashboard/spa/src/components/agent-event-log.tsx` with:
```tsx
import { useEffect, useRef, useState } from "react"
import { describeActivity, formatCost, formatTokens } from "../lib/formatters"
import type { AgentInvocationState, AgentEventRecord, ToolType } from "../types"

// ── Tool icon ──────────────────────────────────────────────────────────────

function toolIcon(toolType: ToolType): string {
  switch (toolType) {
    case "shell": return "$"
    case "file": return "📄"
    case "mcp": return "⬡"
    case "web": return "🌐"
    default: return "·"
  }
}

// ── Tool call row ──────────────────────────────────────────────────────────

function ToolCallRow({
  toolId,
  agent,
}: {
  toolId: string
  agent: AgentInvocationState
}) {
  const call = agent.toolCalls[toolId]
  if (!call) return null

  const [showFull, setShowFull] = useState(false)
  const MAX_LINES = 20

  const isDone = !!call.completed
  const isSuccess = call.completed?.success
  const spinner = !isDone ? (
    <span className="inline-block w-3 h-3 border border-zinc-500 border-t-blue-400 rounded-full animate-spin" />
  ) : isSuccess ? (
    <span className="text-green-400">✓</span>
  ) : (
    <span className="text-red-400">✗</span>
  )

  const label = describeActivity(call.toolType as ToolType, call.startedDetails)
  const output = call.progress.join("\n")
  const lines = output.split("\n")
  const truncated = !showFull && lines.length > MAX_LINES
  const visibleOutput = truncated ? lines.slice(-MAX_LINES).join("\n") : output

  return (
    <div className="border border-zinc-800 rounded my-1.5">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <span className="text-zinc-500 font-mono">{toolIcon(call.toolType)}</span>
        <span className="text-zinc-300 font-mono flex-1 truncate">{label}</span>
        <span>{spinner}</span>
        {call.toolType === "shell" && isDone && (
          <span className="text-zinc-500 font-mono">
            exit {(call.completed?.details as { exitCode?: number | null })?.exitCode ?? "?"}
          </span>
        )}
      </div>
      {(call.progress.length > 0 || (isDone && !isSuccess)) && (
        <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2">
          {truncated && (
            <div className="text-zinc-600 text-[10px] mb-1">
              [{lines.length - MAX_LINES} lines hidden]{" "}
              <button
                onClick={() => setShowFull(true)}
                className="text-zinc-400 hover:text-zinc-200 underline"
              >
                show full output
              </button>
            </div>
          )}
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto">
            {visibleOutput}
          </pre>
          {isDone && !isSuccess && (
            <div className="text-red-400 text-[11px] mt-1">
              {(call.completed?.details as { errorMessage?: string })?.errorMessage ?? "Failed"}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stats strip ──────────────────────────────────────────────────────────

function StatsStrip({ agent }: { agent: AgentInvocationState }) {
  const { stats } = agent
  const ctxPct =
    stats.context?.contextSize && stats.context.usedTokens
      ? Math.round((stats.context.usedTokens / stats.context.contextSize) * 100)
      : null

  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-zinc-900/60 border border-zinc-800 rounded text-[11px] font-mono text-zinc-400 my-1">
      <span>↑ {formatTokens(stats.tokens?.input ?? 0)}</span>
      <span>↓ {formatTokens(stats.tokens?.output ?? 0)}</span>
      {ctxPct !== null && <span>ctx {ctxPct}%</span>}
      {stats.costUsd !== undefined && <span>{formatCost(stats.costUsd)}</span>}
    </div>
  )
}

// ── Message block ─────────────────────────────────────────────────────────

function MessageBlock({
  content,
  streaming,
}: {
  content: string
  streaming: boolean
}) {
  return (
    <div className="my-1.5 text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
      {content}
      {streaming && (
        <span className="inline-block w-2 h-4 bg-zinc-300 ml-0.5 animate-pulse align-text-bottom" />
      )}
    </div>
  )
}

// ── Reasoning block ───────────────────────────────────────────────────────

function ReasoningBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(streaming)

  useEffect(() => {
    if (!streaming) setExpanded(false)
  }, [streaming])

  return (
    <div className="my-1.5 border border-zinc-800/60 rounded overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800/30 transition-colors"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span className="italic">Thinking{streaming ? "…" : ""}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs text-zinc-500 italic leading-relaxed whitespace-pre-wrap border-t border-zinc-800/60 bg-zinc-950/40">
          {content}
          {streaming && (
            <span className="inline-block w-1.5 h-3 bg-zinc-500 ml-0.5 animate-pulse align-text-bottom" />
          )}
        </div>
      )}
    </div>
  )
}

// ── Error banner ───────────────────────────────────────────────────────────

function ErrorBanner({ code, message }: { code: string; message: string }) {
  return (
    <div className="my-1.5 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
      <span className="font-mono text-xs text-red-400 mr-2">{code}</span>
      {message}
    </div>
  )
}

// ── Main log component ─────────────────────────────────────────────────────

interface Props {
  agent: AgentInvocationState
}

function renderEvent(event: AgentEventRecord, agent: AgentInvocationState, idx: number) {
  switch (event.type) {
    case "message.delta":
    case "message.completed": {
      const msg = agent.messages[event.data.messageId]
      if (!msg) return null
      // Only render the first delta for a message; subsequent events are no-ops (accumulated in state).
      // We detect "first occurrence" by checking if any previous event has same messageId.
      const isFirst = agent.eventLog.findIndex(
        (e) => (e.type === "message.delta" || e.type === "message.completed") && e.data.messageId === event.data.messageId,
      ) === idx
      if (!isFirst) return null
      return <MessageBlock key={event.data.messageId} content={msg.content} streaming={msg.streaming} />
    }
    case "reasoning.delta":
    case "reasoning.completed": {
      if (!agent.reasoning) return null
      const isFirst = agent.eventLog.findIndex(
        (e) => e.type === "reasoning.delta" || e.type === "reasoning.completed",
      ) === idx
      if (!isFirst) return null
      return (
        <ReasoningBlock
          key="reasoning"
          content={agent.reasoning.content}
          streaming={agent.reasoning.streaming}
        />
      )
    }
    case "tool.started": {
      return <ToolCallRow key={event.data.toolId} toolId={event.data.toolId} agent={agent} />
    }
    case "tool.progress":
    case "tool.completed":
      return null  // handled by ToolCallRow which reads from agent.toolCalls
    case "stats.updated": {
      const isLast = agent.eventLog.slice(idx + 1).every((e) => e.type !== "stats.updated")
      if (!isLast) return null
      return <StatsStrip key={`stats-${idx}`} agent={agent} />
    }
    case "error":
      return (
        <ErrorBanner
          key={`error-${idx}`}
          code={event.data.code}
          message={event.data.message}
        />
      )
    default:
      return null
  }
}

export function AgentEventLog({ agent }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)

  useEffect(() => {
    if (!userScrolled) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [agent.eventLog.length, userScrolled])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setUserScrolled(!atBottom)
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-0.5"
    >
      {agent.eventLog.map((event, idx) => renderEvent(event, agent, idx))}
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
bun run build:spa
```

Then open a running job's detail view while it's processing agent events. Verify:
- Message text streams in character by character (blinking cursor visible while streaming)
- Reasoning block collapses when complete, expands on click
- Tool call rows appear with correct icon; progress/output streams inside; spinner → ✓/✗ on completion
- Shell tool shows exit code
- Stats strip updates in-place (↑ ↓ ctx% $cost)
- Error banner appears on red background
- Auto-scroll follows new events; pauses when user scrolls up; resumes when user scrolls to bottom

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/spa/src/components/agent-event-log.tsx
git commit -m "feat(dashboard): implement agent event log with streaming, tool calls, and auto-scroll"
```

---

## Task 10: Agents View

**Files:**
- Modify: `src/dashboard/spa/src/components/agents-view.tsx` (replace stub)

Shows a live grid of all currently-active agent invocations across all flows.

- [ ] **Step 1: Implement agents-view.tsx**

Replace `src/dashboard/spa/src/components/agents-view.tsx` with:
```tsx
import { useAppState, type View } from "../app"
import { formatTokens, formatCost } from "../lib/formatters"
import type { AgentInvocationState } from "../types"

interface AgentRow {
  provider: string
  model: string
  flowId: string
  jobId: string
  step: string
  agent: AgentInvocationState
}

interface Props {
  navigate: (v: View) => void
}

function ContextBar({ used, total }: { used?: number; total?: number }) {
  if (!used || !total) return <span className="text-zinc-600">—</span>
  const pct = Math.min(100, Math.round((used / total) * 100))
  const color = pct > 80 ? "bg-red-400" : pct > 60 ? "bg-yellow-400" : "bg-blue-400"
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-400">{pct}%</span>
    </div>
  )
}

export function AgentsView({ navigate }: Props) {
  const state = useAppState()

  const rows: AgentRow[] = []
  for (const flow of Object.values(state.flows)) {
    for (const job of Object.values(flow.jobs)) {
      if (job.status !== "running") continue
      const run = job.runs[job.runs.length - 1]
      if (!run) continue
      for (const step of run.steps) {
        if (step.status !== "running" || !step.agent) continue
        rows.push({
          provider: step.agent.provider,
          model: step.agent.model,
          flowId: flow.id,
          jobId: job.jobId,
          step: step.name,
          agent: step.agent,
        })
      }
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-zinc-100 mb-4">
        Active Agents
        {rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-zinc-500">({rows.length})</span>
        )}
      </h1>

      {rows.length === 0 && (
        <p className="text-zinc-500 text-sm">No active agents right now.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                <th className="pb-2 pr-4 font-medium">Agent</th>
                <th className="pb-2 pr-4 font-medium">Flow</th>
                <th className="pb-2 pr-4 font-medium">Job</th>
                <th className="pb-2 pr-4 font-medium">Step</th>
                <th className="pb-2 pr-4 font-medium">Context</th>
                <th className="pb-2 pr-4 font-medium text-right">Input</th>
                <th className="pb-2 pr-4 font-medium text-right">Output</th>
                <th className="pb-2 pr-4 font-medium text-right">Tools</th>
                <th className="pb-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.flowId}-${row.jobId}-${row.step}`}
                  onClick={() =>
                    navigate({ type: "job-detail", flowId: row.flowId, jobId: row.jobId })
                  }
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 pr-4 text-zinc-300 text-xs">
                    {row.provider} / {row.model}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-400 font-mono text-xs">{row.flowId}</td>
                  <td className="py-2.5 pr-4 text-zinc-400 font-mono text-xs">{row.jobId}</td>
                  <td className="py-2.5 pr-4 text-zinc-400 font-mono text-xs">{row.step}</td>
                  <td className="py-2.5 pr-4">
                    <ContextBar
                      used={row.agent.stats.context?.usedTokens}
                      total={row.agent.stats.context?.contextSize}
                    />
                  </td>
                  <td className="py-2.5 pr-4 text-right text-zinc-400 font-mono text-xs">
                    {formatTokens(row.agent.stats.tokens?.input ?? 0)}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-zinc-400 font-mono text-xs">
                    {formatTokens(row.agent.stats.tokens?.output ?? 0)}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-zinc-400 font-mono text-xs">
                    {row.agent.stats.toolCalls ?? 0}
                  </td>
                  <td className="py-2.5 text-right text-zinc-400 font-mono text-xs">
                    {formatCost(row.agent.stats.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
bun run build:spa
```

Open the Agents view. Verify:
- Empty state message when no agents are running
- When jobs run with agent steps, rows appear live
- Context window progress bar fills and changes color (blue → yellow → red)
- Clicking a row navigates to the job detail view

Expected: No TypeScript errors, no console errors.

- [ ] **Step 3: Run all unit tests one final time**

```bash
bun test src/dashboard/spa/src/lib/
```

Expected: All tests pass (state-reducer + formatters).

- [ ] **Step 4: Run full build**

```bash
bun run build
```

Expected: `build:spa` completes, server bundles compile, SPA files are copied to `dist/dashboard/spa/dist/`. No errors.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/spa/src/components/agents-view.tsx
git commit -m "feat(dashboard): implement active agents grid view"
```

---

## Self-Review Checklist

Checked spec coverage:

| PRD requirement | Task |
|---|---|
| SSE-only transport (no polling) | Task 5 — useEventStream |
| Full event history for late-joining browser | Task 5 — EventSource reconnects and gets full history from server |
| Sidebar: flow list + running count | Task 6 |
| Sidebar: agents nav + active count | Task 6 |
| Sidebar selection persists in localStorage | Task 5 (app.tsx) |
| Jobs grid with all columns | Task 7 |
| Job filter (active/all) persists in localStorage | Task 7 |
| Show 10 most recent completed + "Show more" | Task 7 |
| Job detail: breadcrumb | Task 8 |
| Job detail: header with live stats | Task 8 |
| Job detail: runs collapsible | Task 8 |
| Job detail: steps with status indicators | Task 8 |
| Job detail: agent steps expand automatically when running | Task 8 (defaultExpanded when status=running) |
| Agent event log: all 10 event types rendered | Task 9 |
| Tool call rows keyed by toolId | Task 9 |
| Tool progress inside tool row | Task 9 |
| Auto-scroll pause/resume | Task 9 |
| Agents view grid with all columns | Task 10 |
| Context window progress bar | Task 10 |
| Agents view: click navigates to job detail | Task 10 |
| Stop job button | Task 8 |
| Live duration timers | Task 4 (Duration component) |
| Status pills | Task 4 (StatusPill component) |

**Notes / known gaps:**

1. **`import.meta.url` in bundled production**: `SPA_DIR = new URL("./spa/dist/", import.meta.url)` resolves relative to `dist/index.js` at runtime, giving `dist/spa/dist/`. But the copy step puts files at `dist/dashboard/spa/dist/`. If this resolves incorrectly after `bun build`, expose `spaDir` as a parameter to `startDashboard` and compute it in `serfs.ts` using `import.meta.dir` or an env variable. Test by running `dist/index.js` directly after build.

2. **Late-joining event history**: The PRD says "a browser connecting mid-run receives the full prior event history". The current server SSE implementation only streams new events — it doesn't replay history. This is a server-side gap (out of scope for the dashboard SPA), but the SPA correctly processes any replayed events if the server adds this capability.

3. **No component-level tests**: React components are tested manually via the dev server. Adding Vitest + React Testing Library would enable automated component tests but is not included in v1 scope.
