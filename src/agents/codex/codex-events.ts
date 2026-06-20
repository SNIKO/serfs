import type { McpToolCallItem, ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk"

import type {
  AgentEvent,
  AgentStats,
  ErrorCode,
  FileToolCompletedDetails,
  FileToolStartedDetails,
  McpToolCompletedDetails,
  McpToolError,
  McpToolStartedDetails,
  OtherToolCompletedDetails,
  OtherToolProgressDetails,
  OtherToolStartedDetails,
  RawEvent,
  ShellToolCompletedDetails,
  ShellToolProgressDetails,
  ShellToolStartedDetails,
  WebToolDetails,
} from "../types.ts"

interface ToolState {
  lastOutput: string
}

type CodexItemEvent = Extract<
  ThreadEvent,
  { type: "item.started" | "item.updated" | "item.completed" }
>

type ItemEventPhase = CodexItemEvent["type"]

export interface RunState {
  startTime: number
  hasError: boolean
  lastErrorMessage?: string
  messageContent: string
  tools: Map<string, ToolState>
  stats: AgentStats
}

export function createRunState(): RunState {
  return {
    startTime: Date.now(),
    hasError: false,
    lastErrorMessage: undefined,
    messageContent: "",
    tools: new Map(),
    stats: { tokens: {} },
  }
}

export function mapCodexEvent(event: ThreadEvent, state: RunState): AgentEvent[] {
  switch (event.type) {
    case "thread.started":
    case "turn.started":
      return []
    case "turn.completed":
      return [mapUsageToStats(event.usage, state)]
    case "turn.failed":
      state.hasError = true
      state.lastErrorMessage = event.error.message
      return [createErrorEvent("PROVIDER_ERROR", event.error.message)]
    case "error":
      state.hasError = true
      state.lastErrorMessage = event.message
      return [createErrorEvent("PROVIDER_ERROR", event.message)]
    case "item.started":
    case "item.updated":
    case "item.completed":
      return mapItemEvent(event, state)
    default:
      return []
  }
}

export function createRawEvent(event: ThreadEvent): RawEvent<ThreadEvent> {
  return {
    type: "raw",
    timestamp: Date.now(),
    provider: "codex",
    data: event,
  }
}

export function createErrorEvent(
  code: ErrorCode,
  message: string,
  recoverable = false,
): AgentEvent {
  return {
    type: "error",
    timestamp: Date.now(),
    data: { code, message, recoverable },
  }
}

export const formatParseError = (error: Error): AgentEvent =>
  createErrorEvent("PARSE_ERROR", `Failed to parse output: ${error.message}`)

export function createRunError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function getErrorCode(error: Error): ErrorCode {
  return error.name === "AbortError" ? "ABORTED" : "PROVIDER_ERROR"
}

function mapItemEvent(itemEvent: CodexItemEvent, state: RunState): AgentEvent[] {
  const { item, type } = itemEvent

  switch (item.type) {
    case "agent_message":
      return mapAgentMessage(item, type, state)
    case "reasoning":
      return mapReasoning(item, type, state)
    case "command_execution":
      return mapCommandExecution(item, type, state)
    case "file_change":
      return mapFileChange(item, type, state)
    case "mcp_tool_call":
      return mapMcpToolCall(item, type, state)
    case "web_search":
      return mapWebSearch(item, type, state)
    case "todo_list":
      return mapTodoList(item, type, state)
    case "error":
      return [createErrorEvent("PROVIDER_ERROR", item.message, true)]
    default:
      return mapUnknownItem(item, type, state)
  }
}

function mapAgentMessage(
  item: Extract<ThreadItem, { type: "agent_message" }>,
  phase: ItemEventPhase,
  state: RunState,
): AgentEvent[] {
  if (phase !== "item.completed") {
    return []
  }

  state.messageContent = item.text
  if (!item.text) {
    return []
  }
  return [
    {
      type: "message.completed",
      timestamp: Date.now(),
      data: { messageId: item.id, content: item.text },
    },
  ]
}

function mapReasoning(
  item: Extract<ThreadItem, { type: "reasoning" }>,
  phase: ItemEventPhase,
  _state: RunState,
): AgentEvent[] {
  if (phase !== "item.completed") {
    return []
  }

  if (!item.text) {
    return []
  }
  return [
    {
      type: "reasoning.completed",
      timestamp: Date.now(),
      data: { content: item.text },
    },
  ]
}

function mapCommandExecution(
  item: Extract<ThreadItem, { type: "command_execution" }>,
  phase: ItemEventPhase,
  state: RunState,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const ts = Date.now()
  const existing = state.tools.get(item.id) ?? createToolState()

  if (!state.tools.has(item.id)) {
    state.tools.set(item.id, existing)
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    events.push(
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "shell",
          details: buildShellStartedDetails(item),
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    )
  }

  const output = item.aggregated_output ?? ""
  if (phase === "item.updated") {
    const delta = output.slice(existing.lastOutput.length)
    if (delta) {
      existing.lastOutput = output
      events.push({
        type: "tool.progress",
        timestamp: ts,
        data: {
          toolId: item.id,
          message: delta,
          details: buildShellProgressDetails(delta),
        },
      })
    }
  }

  if (phase === "item.completed") {
    const success = item.status === "completed"
    state.tools.delete(item.id)
    events.push({
      type: "tool.completed",
      timestamp: ts,
      data: {
        toolId: item.id,
        toolType: "shell",
        success,
        details: buildShellCompletedDetails(item),
      },
    })
  }

  return events
}

function mapMcpToolCall(
  item: Extract<ThreadItem, { type: "mcp_tool_call" }>,
  phase: ItemEventPhase,
  state: RunState,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const ts = Date.now()
  const existing = state.tools.get(item.id) ?? createToolState()

  if (!state.tools.has(item.id)) {
    state.tools.set(item.id, existing)
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    events.push(
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "mcp",
          details: buildMcpStartedDetails(item),
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    )
  }

  if (phase === "item.completed") {
    const success = item.status === "completed"
    state.tools.delete(item.id)
    events.push({
      type: "tool.completed",
      timestamp: ts,
      data: {
        toolId: item.id,
        toolType: "mcp",
        success,
        details: buildMcpCompletedDetails(item),
      },
    })
  }

  return events
}

function mapFileChange(
  item: Extract<ThreadItem, { type: "file_change" }>,
  phase: ItemEventPhase,
  state: RunState,
): AgentEvent[] {
  const ts = Date.now()
  const details = buildFileChangeDetails(item)

  const events: AgentEvent[] = []
  if (!state.tools.has(item.id)) {
    state.tools.set(item.id, createToolState())
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    events.push(
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "file",
          details,
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    )
  }

  if (phase !== "item.completed") {
    return events
  }

  state.tools.delete(item.id)
  const completedEvent: AgentEvent = {
    type: "tool.completed",
    timestamp: ts,
    data: {
      toolId: item.id,
      toolType: "file",
      success: item.status === "completed",
      details,
    },
  }
  events.push(completedEvent)

  if (item.status === "failed") {
    events.push(createErrorEvent("PROVIDER_ERROR", "File change failed", true))
  }

  return events
}

function mapWebSearch(
  item: Extract<ThreadItem, { type: "web_search" }>,
  phase: ItemEventPhase,
  state: RunState,
): AgentEvent[] {
  const ts = Date.now()
  if (phase === "item.started") {
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    return [
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "web",
          details: buildWebDetails(item),
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    ]
  }

  if (phase === "item.completed") {
    return [
      {
        type: "tool.completed",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "web",
          success: true,
          details: buildWebDetails(item),
        },
      },
    ]
  }

  return []
}

function mapTodoList(
  item: Extract<ThreadItem, { type: "todo_list" }>,
  phase: ItemEventPhase,
  state: RunState,
): AgentEvent[] {
  const summary = item.items
    .map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`)
    .join("\n")
  const ts = Date.now()

  if (phase === "item.started") {
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    return [
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "other",
          details: buildTodoStartedDetails(item),
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    ]
  }

  if (phase === "item.completed") {
    return [
      {
        type: "tool.completed",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "other",
          success: true,
          details: buildTodoCompletedDetails(item, summary),
        },
      },
    ]
  }

  return [
    {
      type: "tool.progress",
      timestamp: ts,
      data: {
        toolId: item.id,
        message: summary,
        details: buildTodoProgressDetails(summary),
      },
    },
  ]
}

function mapUnknownItem(item: ThreadItem, phase: ItemEventPhase, state: RunState): AgentEvent[] {
  const ts = Date.now()
  const details = buildUnknownDetails(item)

  if (phase === "item.started") {
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    return [
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "other",
          details,
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    ]
  }

  if (phase === "item.completed") {
    return [
      {
        type: "tool.completed",
        timestamp: ts,
        data: {
          toolId: item.id,
          toolType: "other",
          success: true,
          details,
        },
      },
    ]
  }

  return []
}

function mapUsageToStats(usage: Usage, state: RunState): AgentEvent {
  const input = usage.input_tokens
  const output = usage.output_tokens
  state.stats.tokens = {
    input,
    output,
    total: input + output,
    cachedInput: usage.cached_input_tokens,
    reasoningOutput: (usage as Record<string, number | undefined>).reasoning_output_tokens,
  }
  return { type: "stats.updated", timestamp: Date.now(), data: state.stats }
}

function buildShellStartedDetails(
  item: Extract<ThreadItem, { type: "command_execution" }>,
): ShellToolStartedDetails {
  return { command: item.command }
}

function buildShellProgressDetails(output: string): ShellToolProgressDetails {
  return { output }
}

function buildShellCompletedDetails(
  item: Extract<ThreadItem, { type: "command_execution" }>,
): ShellToolCompletedDetails {
  const output = item.aggregated_output || undefined
  return {
    command: item.command,
    output,
    exitCode: item.exit_code ?? null,
  }
}

function buildFileChangeDetails(
  item: Extract<ThreadItem, { type: "file_change" }>,
): FileToolStartedDetails & FileToolCompletedDetails {
  return {
    operations: item.changes.map((change) => ({
      path: change.path,
      kind: mapFileChangeKind(change.kind),
    })),
  }
}

function buildMcpStartedDetails(item: McpToolCallItem): McpToolStartedDetails {
  return {
    server: item.server,
    tool: item.tool,
    arguments: item.arguments,
  }
}

function buildMcpCompletedDetails(item: McpToolCallItem): McpToolCompletedDetails {
  const error = buildMcpToolError(item.error)
  return {
    server: item.server,
    tool: item.tool,
    arguments: item.arguments,
    result: item.result,
    error,
    errorMessage: error?.message,
  }
}

function buildWebDetails(item: Extract<ThreadItem, { type: "web_search" }>): WebToolDetails {
  const action = getWebSearchAction(item)
  if (action === "search") {
    return { action: "search", query: item.query }
  }

  if (isUrl(item.query)) {
    return { action: "open", url: item.query }
  }

  return { action: "other", input: item }
}

function buildTodoStartedDetails(
  item: Extract<ThreadItem, { type: "todo_list" }>,
): OtherToolStartedDetails {
  return {
    name: "todo_list",
    input: { items: item.items },
  }
}

function buildTodoProgressDetails(output: string): OtherToolProgressDetails {
  return { name: "todo_list", output }
}

function buildTodoCompletedDetails(
  item: Extract<ThreadItem, { type: "todo_list" }>,
  output: string,
): OtherToolCompletedDetails {
  return {
    name: "todo_list",
    input: { items: item.items },
    output,
  }
}

function buildUnknownDetails(
  item: ThreadItem,
): OtherToolStartedDetails & OtherToolCompletedDetails {
  return {
    name: item.type,
    input: item,
  }
}

function getWebSearchAction(item: Extract<ThreadItem, { type: "web_search" }>): unknown {
  if ("action" in item) {
    return item.action
  }
  return { type: "other" }
}

function createToolState(): ToolState {
  return { lastOutput: "" }
}

function mapFileChangeKind(kind: string): "add" | "update" | "delete" {
  const kindMap: Record<string, "delete" | "add" | "update"> = {
    delete: "delete",
    add: "add",
    update: "update",
  }
  return kindMap[kind] ?? "update"
}

function buildMcpToolError(error: { message: string } | undefined): McpToolError | undefined {
  if (!error) {
    return undefined
  }
  return error
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function isUrl(value: unknown): boolean {
  const url = getString(value)
  if (!url) {
    return false
  }
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
  } catch {
    return false
  }
}
