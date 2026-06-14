import {
  Codex,
  type CodexOptions,
  type ThreadOptions as CodexThreadOptions,
  type TurnOptions as CodexTurnOptions,
  type McpToolCallItem,
  type ThreadEvent,
  type ThreadItem,
  type Usage,
} from "@openai/codex-sdk"
import { renderMessages, runWithEvents, tryParseOutput } from "./agent.ts"
import type {
  Agent,
  AgentEvent,
  AgentStats,
  CodexAgentConfig,
  CodexProviderOptions,
  ErrorCode,
  McpServerConfig,
  RawEvent,
  RunHandle,
  RunOptions,
} from "./types.ts"

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject

type CodexConfigObject = {
  [key: string]: CodexConfigValue
}

interface ToolState {
  name: string
  kind: "builtin" | "mcp"
  lastOutput: string
}

interface RunState {
  startTime: number
  hasError: boolean
  lastErrorMessage?: string
  messageContent: string
  reasoningContent: string
  messagesById: Map<string, string>
  reasoningById: Map<string, string>
  tools: Map<string, ToolState>
  stats: AgentStats
}

interface CodexRunContext {
  codexClient: Codex
  config: CodexAgentConfig
  providerOptions: CodexProviderOptions
}

// Agent construction

export function createCodexAgent(config: CodexAgentConfig): Agent {
  const providerOptions: CodexProviderOptions = config.providerOptions ?? {}
  const codexClient = new Codex(buildCodexClientOptions(config, providerOptions))

  return {
    provider: config.provider,
    model: config.model,
    run: (options) => runCodexAgent(options, { codexClient, config, providerOptions }),
    close: closeCodexAgent,
  }
}

// Run lifecycle

function runCodexAgent<T = string>(options: RunOptions<T>, context: CodexRunContext): RunHandle<T> {
  const state = createRunState()
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const events = streamCodexThreadEvents(options, state, context, resolve, reject)

  return runWithEvents(events, promise, reject)
}

function createRunState(): RunState {
  return {
    startTime: Date.now(),
    hasError: false,
    lastErrorMessage: undefined,
    messageContent: "",
    reasoningContent: "",
    messagesById: new Map(),
    reasoningById: new Map(),
    tools: new Map(),
    stats: { tokens: {} },
  }
}

async function* streamCodexThreadEvents<T>(
  options: RunOptions<T>,
  state: RunState,
  context: CodexRunContext,
  resolve: (output: T) => void,
  reject: (error: Error) => void,
): AsyncGenerator<AgentEvent, void> {
  try {
    yield* runCodexThread(options, state, context)
    yield* finishCodexRun(options, state, resolve, reject)
  } catch (error) {
    const err = createRunError(error)
    yield createErrorEvent(getErrorCode(err), err.message, err.name === "AbortError")
    reject(err)
  }
}

async function* runCodexThread<T>(
  options: RunOptions<T>,
  state: RunState,
  context: CodexRunContext,
): AsyncGenerator<AgentEvent, void> {
  const { config, codexClient } = context
  const thread = codexClient.startThread(buildCodexThreadOptions(config))
  const prompt = renderMessages(options.messages)
  const { events } = await thread.runStreamed(prompt, {
    outputSchema: options.outputSchema?.toJSONSchema(),
    signal: options.abortSignal,
  } satisfies CodexTurnOptions)

  for await (const event of events) {
    if (options.emitRawEvents ?? false) {
      yield createRawEvent(event)
    }

    for (const mappedEvent of mapCodexEvent(event, state)) {
      yield mappedEvent
    }

    if (state.hasError) {
      throw new Error(state.lastErrorMessage ?? "Codex run failed")
    }
  }
}

async function* finishCodexRun<T>(
  options: RunOptions<T>,
  state: RunState,
  resolve: (output: T) => void,
  reject: (error: Error) => void,
): AsyncGenerator<AgentEvent, void> {
  state.stats.durationMs = Date.now() - state.startTime
  yield { type: "stats.updated", timestamp: Date.now(), data: state.stats }

  const parsedOutput = tryParseOutput<T>(
    state.messageContent,
    options.outputSchema,
    formatParseError,
  )
  if (!parsedOutput.ok) {
    yield parsedOutput.event
    reject(parsedOutput.error)
    return
  }

  resolve(parsedOutput.output)
}

function closeCodexAgent(): Promise<void> {
  return Promise.resolve()
}

// Event mapping

function mapCodexEvent(event: ThreadEvent, state: RunState): AgentEvent[] {
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

function mapItemEvent(
  itemEvent: Extract<ThreadEvent, { type: "item.started" | "item.updated" | "item.completed" }>,
  state: RunState,
): AgentEvent[] {
  const { item, type } = itemEvent

  switch (item.type) {
    case "agent_message":
      return mapAgentMessage(item, type, state)
    case "reasoning":
      return mapReasoning(item, type, state)
    case "command_execution":
      return mapCommandExecution(item, type, state)
    case "file_change":
      return type === "item.completed" ? mapFileChange(item) : []
    case "mcp_tool_call":
      return mapMcpToolCall(item, type, state)
    case "web_search":
      return mapWebSearch(item, type, state)
    case "todo_list":
      return mapTodoList(item, type, state)
    case "error":
      return [createErrorEvent("PROVIDER_ERROR", item.message, true)]
    default:
      return []
  }
}

function mapAgentMessage(
  item: Extract<ThreadItem, { type: "agent_message" }>,
  phase: "item.started" | "item.updated" | "item.completed",
  state: RunState,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const ts = Date.now()
  const delta = computeDelta(item.id, item.text, state.messagesById)

  if (delta) {
    state.messageContent = item.text
    events.push({
      type: "message.delta",
      timestamp: ts,
      data: { messageId: item.id, delta },
    })
  }

  if (phase === "item.completed") {
    state.messageContent = item.text
    events.push({
      type: "message.completed",
      timestamp: ts,
      data: { messageId: item.id, content: item.text },
    })
  }

  return events
}

function mapReasoning(
  item: Extract<ThreadItem, { type: "reasoning" }>,
  phase: "item.started" | "item.updated" | "item.completed",
  state: RunState,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const ts = Date.now()
  const delta = computeDelta(item.id, item.text, state.reasoningById)

  if (delta) {
    state.reasoningContent = item.text
    events.push({
      type: "reasoning.delta",
      timestamp: ts,
      data: { reasoningId: item.id, delta },
    })
  }

  if (phase === "item.completed") {
    state.reasoningContent = item.text
    events.push({
      type: "reasoning.completed",
      timestamp: ts,
      data: { reasoningId: item.id, content: item.text },
    })
  }

  return events
}

function mapCommandExecution(
  item: Extract<ThreadItem, { type: "command_execution" }>,
  phase: "item.started" | "item.updated" | "item.completed",
  state: RunState,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const ts = Date.now()
  const existing = state.tools.get(item.id) ?? createToolState(item.command, "builtin")

  if (!state.tools.has(item.id)) {
    state.tools.set(item.id, existing)
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    events.push(
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          name: existing.name,
          kind: "builtin",
          input: { command: item.command },
        },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    )
  }

  const output = item.aggregated_output ?? ""
  if (phase === "item.updated" || phase === "item.completed") {
    const delta = output.slice(existing.lastOutput.length)
    if (delta) {
      existing.lastOutput = output
      events.push({
        type: "tool.progress",
        timestamp: ts,
        data: { toolId: item.id, message: delta },
      })
    }
  }

  if (phase === "item.completed") {
    const success = item.status === "completed"
    let error: string | undefined
    if (success) {
      error = undefined
    } else if (item.exit_code === undefined) {
      error = "Command failed"
    } else {
      error = `Command failed (exit code ${item.exit_code})`
    }

    state.tools.delete(item.id)
    events.push({
      type: "tool.completed",
      timestamp: ts,
      data: {
        toolId: item.id,
        name: existing.name,
        success,
        output: output || undefined,
        error,
      },
    })
  }

  return events
}

function mapMcpToolCall(
  item: Extract<ThreadItem, { type: "mcp_tool_call" }>,
  phase: "item.started" | "item.updated" | "item.completed",
  state: RunState,
): AgentEvent[] {
  const events: AgentEvent[] = []
  const ts = Date.now()
  const existing = state.tools.get(item.id) ?? createToolState(item.tool, "mcp")

  if (!state.tools.has(item.id)) {
    state.tools.set(item.id, existing)
    state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
    events.push(
      {
        type: "tool.started",
        timestamp: ts,
        data: {
          toolId: item.id,
          name: item.tool,
          kind: "mcp",
          input: normalizeToolInput(item.arguments),
          mcp: { server: item.server, tool: item.tool },
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
        name: item.tool,
        success,
        output: success ? serializeMcpResult(item) : undefined,
        error: success ? undefined : item.error?.message,
      },
    })
  }

  return events
}

function mapFileChange(item: Extract<ThreadItem, { type: "file_change" }>): AgentEvent[] {
  if (item.status === "failed") {
    return [createErrorEvent("PROVIDER_ERROR", "File change failed", true)]
  }

  return [
    {
      type: "file.changed",
      timestamp: Date.now(),
      data: {
        changes: item.changes.map((change) => {
          const kindMap: Record<string, "delete" | "add" | "modify"> = {
            delete: "delete",
            add: "add",
          }
          return {
            path: change.path,
            kind: kindMap[change.kind] ?? "modify",
          }
        }),
      },
    },
  ]
}

function mapWebSearch(
  item: Extract<ThreadItem, { type: "web_search" }>,
  phase: "item.started" | "item.updated" | "item.completed",
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
          name: "web_search",
          kind: "builtin",
          input: { query: item.query },
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
        data: { toolId: item.id, name: "web_search", success: true, output: item.query },
      },
    ]
  }

  return []
}

function mapTodoList(
  item: Extract<ThreadItem, { type: "todo_list" }>,
  phase: "item.started" | "item.updated" | "item.completed",
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
        data: { toolId: item.id, name: "todo_list", kind: "builtin", input: { items: item.items } },
      },
      { type: "stats.updated", timestamp: ts, data: state.stats },
    ]
  }

  if (phase === "item.completed") {
    return [
      {
        type: "tool.completed",
        timestamp: ts,
        data: { toolId: item.id, name: "todo_list", success: true, output: summary },
      },
    ]
  }

  return [
    {
      type: "tool.progress",
      timestamp: ts,
      data: { toolId: item.id, message: summary },
    },
  ]
}

function mapUsageToStats(usage: Usage, state: RunState): AgentEvent {
  const input = usage.input_tokens
  const output = usage.output_tokens
  state.stats.tokens = {
    input,
    output,
    total: input + output,
  }
  return { type: "stats.updated", timestamp: Date.now(), data: state.stats }
}

// Event factories

function createRawEvent(event: ThreadEvent): RawEvent<ThreadEvent> {
  return {
    type: "raw",
    timestamp: Date.now(),
    provider: "codex",
    data: event,
  }
}

function createErrorEvent(code: ErrorCode, message: string, recoverable = false): AgentEvent {
  return {
    type: "error",
    timestamp: Date.now(),
    data: { code, message, recoverable },
  }
}

const formatParseError = (error: Error): AgentEvent =>
  createErrorEvent("PARSE_ERROR", `Failed to parse output: ${error.message}`)

// Codex configuration

function buildCodexClientOptions(
  config: CodexAgentConfig,
  providerOptions: CodexProviderOptions,
): CodexOptions {
  const codexConfig = buildCodexConfig(providerOptions.config, config.mcpServers)
  return {
    apiKey: providerOptions.apiKey,
    baseUrl: providerOptions.baseUrl,
    codexPathOverride: providerOptions.codexPathOverride,
    env: buildCodexEnv(config.env, providerOptions.env),
    config: hasObjectKeys(codexConfig) ? codexConfig : undefined,
  }
}

function buildCodexEnv(
  configEnv?: Record<string, string>,
  providerEnv?: Record<string, string>,
): Record<string, string> | undefined {
  if (!configEnv && !providerEnv) {
    return undefined
  }

  return { ...getProcessEnv(), ...providerEnv, ...configEnv }
}

function getProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

function buildCodexThreadOptions(config: CodexAgentConfig): CodexThreadOptions {
  return {
    model: config.model ?? config.providerOptions?.model,
    workingDirectory: config.cwd ?? config.providerOptions?.workingDirectory,
    skipGitRepoCheck: config.providerOptions?.skipGitRepoCheck,
    modelReasoningEffort: config.providerOptions?.modelReasoningEffort,
    networkAccessEnabled: config.providerOptions?.networkAccessEnabled,
    webSearchMode: config.providerOptions?.webSearchMode,
    webSearchEnabled: config.providerOptions?.webSearchEnabled,
    approvalPolicy: config.providerOptions?.approvalPolicy,
    sandboxMode: config.providerOptions?.sandboxMode,
    additionalDirectories: config.providerOptions?.additionalDirectories,
  }
}

function buildCodexConfig(
  providerConfig?: CodexConfigObject,
  mcpServers?: Record<string, McpServerConfig>,
): CodexConfigObject {
  const codexConfig: CodexConfigObject = { ...(providerConfig ?? {}) }
  if (mcpServers) {
    codexConfig.mcp_servers = translateMcpServers(mcpServers)
  }

  return codexConfig
}

function translateMcpServers(mcpServers?: Record<string, McpServerConfig>): CodexConfigObject {
  const codexMcpServers: CodexConfigObject = {}
  if (!mcpServers) {
    return codexMcpServers
  }

  for (const [name, server] of Object.entries(mcpServers)) {
    codexMcpServers[name] = translateMcpServer(server)
  }

  return codexMcpServers
}

function translateMcpServer(server: McpServerConfig): CodexConfigObject {
  const codexServer: CodexConfigObject = { enabled: server.enabled }
  if ("url" in server) {
    codexServer.url = server.url
    if (server.headers) {
      codexServer.http_headers = server.headers
    }
  } else {
    codexServer.command = server.command
    if (server.args) {
      codexServer.args = server.args
    }
    if (server.env) {
      codexServer.env = server.env
    }
  }
  if (server.tools.length > 0) {
    codexServer.enabled_tools = server.tools
  }
  return codexServer
}

// Utilities

function createRunError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function getErrorCode(error: Error): ErrorCode {
  return error.name === "AbortError" ? "ABORTED" : "PROVIDER_ERROR"
}

function computeDelta(id: string, text: string, store: Map<string, string>): string {
  const previous = store.get(id) ?? ""
  const delta = text.slice(previous.length)
  store.set(id, text)
  return delta
}

function createToolState(name: string, kind: ToolState["kind"]): ToolState {
  return { name, kind, lastOutput: "" }
}

function serializeMcpResult(item: McpToolCallItem): string | undefined {
  if (item.result?.structured_content) {
    return JSON.stringify(item.result.structured_content)
  }
  if (item.result?.content) {
    return JSON.stringify(item.result.content)
  }
  return undefined
}

function normalizeToolInput(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value
  }
  if (value === undefined) {
    return undefined
  }
  return { value }
}

function hasObjectKeys(value: CodexConfigObject): boolean {
  return Object.keys(value).length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
