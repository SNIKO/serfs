# Serfs Dashboard — API Design

**Status:** Draft  
**Relates to:** DASHBOARD_PRD.md

---

## 1. Transport Strategy

The dashboard uses two layers:

| Layer | Endpoint | Purpose |
|---|---|---|
| **SSE** | `GET /api/events` | Live event stream — all `SerfsEvent` objects as they happen |
| **REST** | `/api/flows/…` | One-time hydration on page load; not polled |

The PRD says *"The SSE connection is the only data transport; no REST polling endpoints are needed for the core views."* In practice the codebase already has REST alongside SSE, and the hybrid is the right call — REST is cleaner for paging completed jobs and fetching agent logs, and it avoids the complexity of server-side event replay.

### Hydration protocol for late-joining browsers

A browser that connects mid-run (page reload, late open) must not miss live events while it fetches initial state:

1. Open `GET /api/events` SSE connection — **buffer all incoming events**
2. Fetch `GET /api/flows` → populate sidebar
3. For each flow, fetch `GET /api/flows/:flowId/jobs` → populate job rows
4. For any job with `status = "running"`, fetch `GET /api/flows/:flowId/jobs/:jobId` → restore run/step structure
5. For any step with `status = "running"` that has an agent, fetch the step log endpoint → replay agent event history
6. Drain the buffered SSE events from step 1 — these fill in anything that happened between step 2 and now
7. Switch to live streaming

This sequence eliminates the race window with no server-side event replay required.

---

## 2. Endpoint Reference

### 2.1 Static Assets

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | SPA shell (`index.html`) |
| `GET` | `/assets/*` | Bundled JS/CSS (content-hashed filenames) |

All unmatched paths that don't start with `/api/` are served from `src/dashboard/spa/`. Path traversal (`..`) is rejected with `403`.

---

### 2.2 SSE Event Stream

#### `GET /api/events`

Opens a persistent SSE connection. The server pushes every `SerfsEvent` as a `data:` frame.

**Response headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Frame format:**
```
data: {"type":"job.queued","flowId":"invoice-processor","jobId":"inv-001","at":1718000000000}

data: {"type":"job.start","flowId":"invoice-processor","jobId":"inv-001","runId":0,"at":1718000001000}

: ping

```

- All frames use the default `message` event type — no `event:` field.
- The `type` property inside the JSON payload is the discriminator; the client routes on it.
- Keepalive `: ping` comments are sent every 15 seconds.
- Buffer is capped at 1 000 unread frames (`CountQueuingStrategy({ highWaterMark: 1000 })`); when `controller.desiredSize < 0` the connection is closed with an error.

**First frame on every new connection:**
```
data: {"type":"stream.ready"}

```
Emitted immediately before any live events. The client should open this connection first, buffer all incoming events, then fetch the REST endpoints, and finally drain the buffer — this eliminates the race window with no server-side event replay required. `raw` inner agent events are suppressed and never appear in the stream.

**Event types streamed** (defined in `src/events/event.types.ts`):

| Type | Meaning |
|---|---|
| `stream.ready` | Connection established; client may now fetch REST endpoints and drain buffer |
| `job.queued` | New job discovered |
| `job.removed` | Job skipped (not runnable) |
| `job.start` | Job picked up from queue |
| `job.end` | Job reached terminal state |
| `step.start` | Step began executing |
| `step.end` | Step finished |
| `agent.event` | LLM event envelope (wraps agent inner events — see §4.4 of PRD; `raw` type suppressed) |

---

### 2.3 Flows

#### `GET /api/flows`

Returns all registered flows.

**Response `200`:**
```json
[
  {
    "id": "invoice-processor",
    "config": {
      "workspaceDir": "/data/invoices",
      "maxConcurrentJobs": 3,
      "pollIntervalMs": 30000
    }
  }
]
```

Used by the sidebar to render the flow list on initial load. This does not change at runtime (flows are registered at startup), so one fetch is sufficient.

---

### 2.4 Jobs

#### `GET /api/flows/:flowId/jobs`

Returns persisted job states for a flow, newest first.

> **Status:** Stub — currently returns `[]`. Needs implementation (walk `stateDir/:flowId/`).

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | comma-separated | `queued,running` | Filter by job status |
| `limit` | number | `50` | Max results |
| `offset` | number | `0` | Pagination offset |

**Response `200`:**
```json
[
  {
    "jobId": "inv-001",
    "flowId": "invoice-processor",
    "status": "running",
    "startedAt": 1718000001000,
    "totals": { "tokens": { "input": 1204, "output": 847 }, "costUsd": 0.0012 }
  }
]
```

The Jobs View fetches this with `status=queued,running` for the live grid, and re-fetches with `status=done,failed,stopped&limit=10` when the user expands the completed-jobs filter.

---

#### `GET /api/flows/:flowId/jobs/:jobId`

Returns the full persisted state for a single job, including all runs and steps.

**Response `200`:**
```json
{
  "jobId": "inv-001",
  "flowId": "invoice-processor",
  "status": "done",
  "startedAt": 1718000001000,
  "endedAt": 1718000060000,
  "error": null,
  "totals": { "tokens": { "input": 1204, "output": 847 }, "costUsd": 0.0012 },
  "runs": [
    {
      "runId": 0,
      "startedAt": 1718000001000,
      "endedAt": 1718000060000,
      "steps": [
        {
          "name": "analyze",
          "status": "done",
          "startedAt": 1718000002000,
          "endedAt": 1718000059000,
          "agent": {
            "provider": "anthropic",
            "model": "claude-opus-4-5",
            "tokens": { "input": 1204, "output": 847 },
            "costUsd": 0.0012,
            "toolCalls": 3,
            "logPath": "..."
          }
        }
      ]
    }
  ]
}
```

**Response `404`:** Job state file does not exist on disk.

Used by the Job Detail View on initial load.

---

#### `GET /api/flows/:flowId/jobs/:jobId/runs/:runId/steps/:step/log`

Returns the raw agent event log for one step as NDJSON (one `AgentEvent` JSON object per line).

```
Content-Type: application/x-ndjson
```

Each line is an `AgentEvent` — the same type that appears as the inner `.event` of `agent.event` SSE envelopes. The client feeds these through the same handler used for live SSE events to reconstruct the agent event log for a completed or in-progress step.

**Response `404`:** Step has no agent, or log file does not exist yet.

This is the replay mechanism for the Agent Event Log in the Job Detail View. For a running step, the client calls this once on load, replays the logged events, then picks up live events from the SSE buffer.

---

### 2.5 Mutations

#### `POST /api/flows/:flowId/jobs/:jobId/stop`

Signal a running job to stop. Aborts its `AbortController` signal; the job handler is responsible for honouring it.

**Response `204`:** Stop signal sent (or job was already not in the queue — not an error).

**Response `404`:** Not used — `queue.stop()` is a no-op for unknown jobs.

---

## 3. Open Gaps

| Gap | PRD section | Complexity |
|---|---|---|
| NDJSON log read for in-progress steps (partial / streaming) | §5.3 Agent Event Log live replay | Low — file is being appended; read from offset on reconnect |
| Agents View data — list all active agent invocations | §5.4 | None needed — derive from SSE in-memory state |

Previously open gaps now resolved: `GET /api/flows/:flowId/jobs` with `?status`, `?limit`, `?offset`; `stream.ready` SSE frame; `X-Accel-Buffering` header; SSE unread-frame buffer tracking; `raw` event suppression.

---

## 4. What the Agents View Does NOT Need a REST Endpoint For

The **Agents View** (§5.4) shows all currently-active agent invocations. Because the client already has full in-memory state derived from SSE, the Agents View is a pure derived view — it filters the in-memory job/step/agent map for entries where `step.status === "running"` and `step.agent` is set. No REST endpoint required.

---

## 5. Design Alternatives Considered

### Pure SSE replay (vs. REST hydration)

The PRD describes this: on SSE connect, the server replays all prior events for active steps before streaming live events.

| | Hybrid REST + SSE (chosen) | Pure SSE replay |
|---|---|---|
| Client code paths | Two: REST bootstrap + SSE live | One: all state from SSE |
| Server complexity | Low — REST reads state files already | High — must reconstruct event sequence from state + NDJSON logs |
| Race window | Closed by buffering SSE before REST fetch | None |
| Completed jobs | Easy to page via REST | Would bloat the replay stream |
| Agent log seek | `logPath` offset for partial reads | Same replay approach, harder to seek |

Hybrid wins because the server already has REST endpoints and persisted state files. Pure SSE replay would require writing a non-trivial event reconstructor with no benefit for the completed-job views.

### `GET /api/snapshot` — single JSON blob of all current state

Simpler for the client than multiple REST calls, but couples the client tightly to a server-assembled shape. The individual REST endpoints are more composable and already exist.
