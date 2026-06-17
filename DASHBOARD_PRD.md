# Serfs Dashboard — Product Requirements Document

**Audience:** Designer  
**Status:** Draft  
**Version:** 1.0

---

## 1. Overview

Serfs is a workflow automation runtime that runs long-lived **jobs** powered by LLM agents. Operators need visibility into what is running, what happened, and whether things are healthy. The dashboard gives them that in real time.

Everything a user cares about arrives as a continuous stream of structured events from a single SSE endpoint (`GET /events`). The dashboard subscribes once and maintains a live in-memory model of all state — no polling, no refresh buttons.

The dashboard is a single-page web application served directly by the Serfs process on port 4000. It is read-only in v1 (except for the stop-job action). There is no authentication.

---

## 2. Core Concepts

### Flow

A **Flow** is a named, recurring workflow that an operator has registered. Think of it like a job type or a pipeline definition. A flow has an ID (e.g., `"invoice-processor"`) and a concurrency configuration. Flows are static — they appear in the sidebar as soon as Serfs starts.

### Job

A **Job** is one execution instance discovered by a Flow. Each job has:
- A unique `jobId` within its flow
- A `status`: `queued` → `running` → `done` / `failed` / `stopped`
- **Token totals** and **cost** accumulated across all its steps

### Run

A **Run** is one attempt to execute a job. If a job is retried, it gets a new run (`runId 0`, `1`, `2`...). Most jobs will have exactly one run.

### Step

A **Step** is a named unit of work within a run. There are two kinds:

- **Code step** — user-defined logic (no agent). Has a name, status, and timing only.
- **Agent step** — an LLM call. Has all of the above plus a full real-time event stream: streamed text, tool calls, token stats, etc.

A job's run typically has one or more named steps executed in sequence.

### Agent Invocation

An **Agent Invocation** is one LLM session within an agent step. It is identified by the `(provider, model)` pair and has its own token usage, cost, and tool call history.

---

## 3. Data Model (Derived from Events)

The dashboard builds this state tree in the browser from the event stream:

```
flows[]
  └─ flow
       ├─ id: string
       └─ jobs[]
            └─ job
                 ├─ jobId: string
                 ├─ flowId: string
                 ├─ status: "queued" | "running" | "done" | "failed" | "stopped"
                 ├─ totals.tokens.input: number
                 ├─ totals.tokens.output: number
                 ├─ totals.costUsd?: number
                 └─ runs[]
                      └─ run
                           ├─ runId: number
                           ├─ startedAt: number (unix ms)
                           ├─ endedAt?: number
                           └─ steps[]
                                └─ step
                                     ├─ name: string
                                     ├─ status: "pending" | "running" | "done" | "failed"
                                     ├─ startedAt?: number
                                     ├─ endedAt?: number
                                     ├─ error?: string
                                     └─ agent? (if agent step)
                                          ├─ provider: string
                                          ├─ model: string
                                          ├─ tokens.input: number
                                          ├─ tokens.output: number
                                          ├─ costUsd?: number
                                          ├─ toolCalls: number
                                          └─ events[] (raw agent event log)
```

---

## 4. Event Reference

All events arrive as newline-delimited JSON over SSE. Each event has a `type` field as a discriminator.

### 4.1 Job Lifecycle Events

These events track the status of a job from discovery to completion.

---

#### `job.queued`

A job has been discovered and is waiting to be executed.

```ts
{
  type: "job.queued"
  flowId: string      // e.g. "invoice-processor"
  jobId:  string      // e.g. "inv-20240614-001"
  at:     number      // unix timestamp (ms)
}
```

**UI implication:** Create a new job row with status `queued`.

---

#### `job.removed`

A job was discovered but determined not to be runnable at this time (e.g., its precondition failed). It will not appear in the queue.

```ts
{
  type:   "job.removed"
  flowId: string
  jobId:  string
  at:     number
  reason: "not-runnable"
}
```

**UI implication:** If the job row exists, remove it silently or mark it with a soft "skipped" indicator.

---

#### `job.start`

A job has been picked up from the queue and is now executing.

```ts
{
  type:   "job.start"
  flowId: string
  jobId:  string
  runId:  number      // 0-indexed attempt number
  at:     number
}
```

**UI implication:** Transition job to `running`. Create a new run entry with `runId`.

---

#### `job.end`

A job has finished (either successfully, with an error, or was stopped).

```ts
{
  type:   "job.end"
  flowId: string
  jobId:  string
  runId:  number
  at:     number
  status: "done" | "failed" | "stopped"
  error?: string      // present when status = "failed"
}
```

**UI implication:** Transition job to terminal status. Show error message if present. Freeze timers.

---

### 4.2 Step Lifecycle Events

Steps are the named units of work within a job run.

---

#### `step.start`

A step has begun executing within a run.

```ts
{
  type:   "step.start"
  flowId: string
  jobId:  string
  runId:  number
  step:   string      // step name, e.g. "fetch-data" or "analyze"
  at:     number
}
```

**UI implication:** Create a step row in the job detail with status `running`. Start its timer.

---

#### `step.end`

A step has finished.

```ts
{
  type:   "step.end"
  flowId: string
  jobId:  string
  runId:  number
  step:   string
  at:     number
  status: "done" | "failed"
  error?: string      // present when status = "failed"
}
```

**UI implication:** Transition step to terminal status. Show error if present. Stop its timer.

---

### 4.3 Agent Event Envelope

Every event emitted by an LLM agent is wrapped in this envelope before being broadcast. The `event` field contains one of the 10 agent event types described in §4.4.

```ts
{
  type:     "agent.event"
  flowId:   string
  jobId:    string
  runId:    number
  step:     string        // which step this agent belongs to
  provider: string        // e.g. "anthropic", "openai"
  model:    string        // e.g. "claude-opus-4-5", "gpt-4o"
  event:    AgentEvent    // see §4.4
}
```

**UI implication:** Route the inner `event` to the correct agent event handler for that `(jobId, step)`.

---

### 4.4 Agent Events (inner `event` payload)

These are the real-time events from the LLM provider, carried inside the `agent.event` envelope.

---

#### `message.delta`

A streaming chunk of the agent's text response. These arrive rapidly while the model is writing.

```ts
{
  type: "message.delta"
  data: {
    messageId: string   // groups chunks into a single message
    delta:     string   // incremental text content to append
  }
  timestamp: number
}
```

**UI implication:** Append `delta` to the streaming message display. Show a blinking cursor.

---

#### `message.completed`

The full, final text response for a message.

```ts
{
  type: "message.completed"
  data: {
    messageId: string
    content:   string   // complete assembled text
  }
  timestamp: number
}
```

**UI implication:** Replace streamed content with the final version. Remove cursor.

---

#### `reasoning.delta`

A streaming chunk of the agent's internal chain-of-thought (only some models emit this — e.g., Claude with extended thinking enabled).

```ts
{
  type: "reasoning.delta"
  data: {
    delta: string
  }
  timestamp: number
}
```

**UI implication:** Show in a collapsible "Thinking…" block, distinct from the main response.

---

#### `reasoning.completed`

The complete reasoning/thinking output.

```ts
{
  type: "reasoning.completed"
  data: {
    content: string
  }
  timestamp: number
}
```

---

#### `tool.started`

The agent has invoked a tool. The `details` vary by `toolType`.

```ts
{
  type: "tool.started"
  data: {
    toolId:   string      // unique ID for this tool call
    toolType: "shell" | "file" | "mcp" | "web" | "other"
    details:  ToolStartedDetails   // varies by toolType, see below
  }
  timestamp: number
}
```

**Details by tool type:**

```ts
// toolType = "shell"
details: {
  command: string         // e.g. "npm test"
}

// toolType = "file"
details: {
  operations: Array<{
    path: string          // file path
    kind: "view" | "add" | "update" | "delete"
  }>
}

// toolType = "mcp"  (Model Context Protocol — external tool server)
details: {
  server:     string      // MCP server name
  tool:       string      // tool name on that server
  arguments?: unknown     // tool input arguments
}

// toolType = "web"
details:
  | { action: "search"; query: string }
  | { action: "open";   url: string }
  | { action: "other";  input: unknown }

// toolType = "other"
details: {
  name?:  string
  input?: unknown
}
```

**UI implication:** Show a tool call badge in the event log. Use `toolType` to pick an appropriate icon (terminal, file, plug, globe). Show the relevant detail (command / file path / MCP tool name / search query).

---

#### `tool.progress`

Intermediate output while a tool is running (most commonly shell stdout).

```ts
{
  type: "tool.progress"
  data: {
    toolId:   string
    message:  string      // human-readable progress text
    details?: 
      | { output: string }        // shell stdout/stderr chunk
      | { name?: string; output?: unknown }   // other
  }
  timestamp: number
}
```

**UI implication:** Stream output inside the tool call row (expandable shell output pane).

---

#### `tool.completed`

A tool call has finished. The `details` vary by `toolType`.

```ts
{
  type: "tool.completed"
  data: {
    toolId:   string
    toolType: "shell" | "file" | "mcp" | "web" | "other"
    success:  boolean
    details:  ToolCompletedDetails   // varies by toolType, see below
  }
  timestamp: number
}
```

**Details by tool type:**

```ts
// toolType = "shell"
details: {
  command:   string
  output?:   string
  exitCode?: number | null
}

// toolType = "file"
details: {
  operations: Array<{ path: string; kind: "view"|"add"|"update"|"delete" }>
  output?:       unknown
  errorMessage?: string
}

// toolType = "mcp"
details: {
  server:        string
  tool:          string
  arguments?:    unknown
  result?:       unknown
  error?:        { message: string; [key: string]: unknown }
  errorMessage?: string
}

// toolType = "web"
details: {
  action:        "search" | "open" | "other"
  query?:        string     // if action = "search"
  url?:          string     // if action = "open"
  input?:        unknown    // if action = "other"
  output?:       unknown
  errorMessage?: string
}

// toolType = "other"
details: {
  name?:   string
  input?:  unknown
  output?: unknown
}
```

**UI implication:** Mark the tool call row as success or failure. Show exit code for shell. Show error message if failed.

---

#### `stats.updated`

Token usage and cost snapshot for this agent invocation. Emitted periodically during a run and once at the end.

```ts
{
  type: "stats.updated"
  data: {
    tokens: {
      input?:           number   // total input tokens so far
      output?:          number   // total output tokens so far
      total?:           number   // input + output
      cachedInput?:     number   // tokens served from cache (saves cost)
      reasoningOutput?: number   // tokens used for chain-of-thought
    }
    context?: {
      contextSize?:  number   // model's maximum context window (tokens)
      usedTokens?:   number   // tokens currently used in the context
    }
    toolCalls?: number        // total tool calls so far
    costUsd?:   number        // estimated USD cost so far
    durationMs?: number       // elapsed wall-clock time (ms)
  }
  timestamp: number
}
```

**UI implication:**
- Update the token counters and cost display on the job row and agents grid.
- Compute `context.usedTokens / context.contextSize` for the context window progress bar.
- `cachedInput` can be used to show a "cache savings" tooltip.

---

#### `error`

The agent encountered an error.

```ts
{
  type: "error"
  data: {
    code:        "ABORTED" | "PARSE_ERROR" | "PROVIDER_ERROR" | "CONFIG_ERROR" | "UNKNOWN"
    message:     string
    recoverable: boolean    // if true, Serfs may retry; if false, the step will fail
  }
  timestamp: number
}
```

**UI implication:** Show an error indicator on the step row. Highlight the error message in the event log.

---

## 5. Dashboard Layout

The dashboard is a single-page application with a **persistent left sidebar** and a **main content area**. The main area has two modes: the **Jobs View** (grid) and the **Job Detail View** (full-replace navigation).

---

### 5.1 Sidebar

The sidebar persists across all views. It has two sections:

**Flows**
- A collapsible list of all registered flows, each with its flow ID.
- Show a live count of running jobs next to each flow name.
- Clicking a flow opens the [Jobs View](#52-jobs-view) for that flow.

**Agents**
- A single navigation item that opens the [Agents View](#53-agents-view).
- Show a live count of currently-active agent invocations.

The active selection is highlighted and **persists across page reloads** (store in `localStorage`).

---

### 5.2 Jobs View

Selecting a flow shows a jobs grid for that flow.

**Header:** Shows the flow ID on the left, tokens / costs summary for all jobs on the right

**Columns:**

| Column | Source | Notes |
|---|---|---|
| Job ID | `job.queued → jobId` | |
| Status | `job.start`, `job.end` | Pill: queued / running / done / failed / stopped |
| Current Step | `step.start → step` | Name of the currently-running step |
| Current Agent | `agent.event → model` | Provider + model string; blank for code steps |
| Activity | `tool.started → details` | What the agent is doing right now (e.g. "shell: npm test") |
| Input Tokens | `stats.updated → tokens.input` | Accumulated across all steps |
| Output Tokens | `stats.updated → tokens.output` | Accumulated across all steps |
| Cost | `stats.updated → costUsd` | USD, formatted to 4 decimal places |
| Duration | `job.start.at` → now | Live-updating elapsed time for running jobs |

**Filtering:**
- Default: show `queued` and `running` jobs only.
- Expandable filter to include `done`, `failed`, `stopped`.
- Filter choice persists in `localStorage`.
- For completed jobs: show the 10 most recent by default, with a "Show more" control.

---

### 5.3 Job Detail View

**Header:** Shows the `<- flow ID / job ID` on the left, tokens / cost summary for this job from all runs on the right.

Clicking a job row **replaces the main content area** with the Job Detail View. A breadcrumb at the top (`← flow-id / job-id`) navigates back to the jobs grid.

This view shows the full execution history of the job: all runs, each run's steps, and the agent event log for each agent step.

#### Header

Displays the job ID, status pill.

#### Runs

Each attempt is shown as tabs labelled `Run #N`.

Run header contains start time, duration, status and tokens / cost stats.

#### Run Steps List

Steps are listed in execution order within their run.

| State | Indicator | Details shown |
|---|---|---|
| `pending` | `○` muted | name only |
| `running` | `●` blue pulse | name, live input/output token counters |
| `done` | `✓` | name, duration, final tokens, cost |
| `failed` | `✗` red | name, duration, error message inline |

Code steps (no agent) show only name, status, and duration. Agent steps are expandable to reveal the **Agent Event Log**.

Running agent steps expand and stream automatically. Completed agent steps are collapsed by default and expand on click.

Each step shows step name, duration, token/cost stats in step header `↑ 1,204  ↓ 847  $0.0012`. For running one updating dynamically.

#### Agent Event Log

A chronological, append-only log of the inner events for that agent step. Tool call rows are **keyed by `toolId`** — `tool.progress` and `tool.completed` update the existing row rather than appending new ones.

| Event | Rendering |
|---|---|
| `message.delta` | Streaming text block; blinking cursor while streaming |
| `message.completed` | Replaces streamed content with final text; cursor removed |
| `reasoning.delta` / `reasoning.completed` | Collapsible `▶ Thinking…` block in muted style; collapsed by default once complete |
| `tool.started` | Tool call row: icon (`$` shell · `📄` file · `⬡` MCP · `🌐` web) + key detail + spinner |
| `tool.progress` | Shell stdout/stderr streamed inside the tool row in a monospace terminal block; truncated to last N lines if very long, with a "show full output" toggle |
| `tool.completed` | Updates the tool row: spinner → ✓/✗, shows exit code for shell, error message on failure |
| `stats.updated` | Updates the step header |
| `error` | Red banner with error code and message |

**Scroll behaviour:** auto-scroll to the bottom while new events are streaming. Pause auto-scroll when the user scrolls up; resume when they scroll back to the bottom.

---

### 5.4 Agents View

Selecting **Agents** shows a live grid of all currently-active agent invocations across all flows.

An agent invocation is "active" while its parent step's status is `running`.

**Columns:**

| Column | Source | Notes |
|---|---|---|
| Agent | `agent.event → provider + model` | e.g. "anthropic / claude-opus-4-5" |
| Flow | `agent.event → flowId` | |
| Job ID | `agent.event → jobId` | |
| Step | `agent.event → step` | |
| Activity | `tool.started → details` | What the agent is doing right now |
| Context window | `stats.updated → context.usedTokens / context.contextSize` | Progress bar |
| Input tokens | `stats.updated → tokens.input` | |
| Output tokens | `stats.updated → tokens.output` | |
| Tool calls | `stats.updated → toolCalls` | |
| Cost | `stats.updated → costUsd` | |

Clicking a row navigates to the parent job's Job Detail View, scrolled to the relevant step's event log.

## 6. Live Data Requirements

- All data updates live — no manual refresh.
- A browser connecting mid-run (page reload, late open) receives the **full prior event history** of any active step from the server before receiving new events.
- The SSE connection is the only data transport; no REST polling endpoints are needed for the core views.

---

## 7. Key Derived Metrics

These are values the UI computes from raw events — not sent directly but important for the design:

| Metric | How to compute |
|---|---|
| Job cost | Sum `costUsd` from the latest `stats.updated` per step |
| Job token totals | Sum `tokens.input` and `tokens.output` across all step `stats.updated` (latest per step) |
| Context window % | `stats.updated.context.usedTokens / stats.updated.context.contextSize × 100` |
| Step duration | `step.end.at - step.start.at` (or `now - step.start.at` for running) |
| Job duration | `job.end.at - job.start.at` (or `now - job.start.at` for running) |
| Active agents count | Count of steps currently in `running` status that have received at least one `agent.event` |

---

## 8. Requirements

Modern, clean UI without too much visual noise. 
Very fast and responsive
Avoid fancy gradients, complex shapes. Animation is fine as long as it is fast and doesn't cause jank.
Focus on clear typography, spacing, and simple color accents for status indicators and icons.