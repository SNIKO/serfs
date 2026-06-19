import {
  CopilotClient,
  type MCPServerConfig as CopilotMcpServerConfig,
  type PermissionHandler,
  type SessionEvent,
} from "@github/copilot-sdk"
import { subscriptionToAsyncGenerator } from "../utils/subscription.ts"
import { renderMessages, runWithEvents, tryParseOutput } from "./agent.ts"
import type {
  Agent,
  AgentEvent,
  AgentStats,
  CopilotAgentConfig,
  ErrorCode,
  FileToolCompletedDetails,
  McpServerConfig,
  McpToolCompletedDetails,
  OtherToolCompletedDetails,
  RawEvent,
  RunHandle,
  RunOptions,
  ShellToolCompletedDetails,
  WebToolCompletedDetails,
} from "./types.ts"

// ============================================
// EVENT MAPPERS
// ============================================

type CopilotToolStartData = Extract<SessionEvent, { type: "tool.execution_start" }>["data"]
type CopilotToolCompleteData = Extract<SessionEvent, { type: "tool.execution_complete" }>["data"]

type ActiveTool =
  | { toolType: "shell"; details: ShellToolCompletedDetails }
  | { toolType: "file"; details: FileToolCompletedDetails }
  | { toolType: "mcp"; details: McpToolCompletedDetails }
  | { toolType: "web"; details: WebToolCompletedDetails }
  | { toolType: "other"; details: OtherToolCompletedDetails }

interface RunState {
  startTime: number
  hasError: boolean
  errorMessage?: string
  messageId?: string
  messageContent: string
  reasoningContent: string
  activeTools: Map<string, ActiveTool>
  ignoredToolIds: Set<string>
  stats: AgentStats
}

function createRunState(): RunState {
  return {
    startTime: Date.now(),
    hasError: false,
    messageContent: "",
    reasoningContent: "",
    activeTools: new Map(),
    ignoredToolIds: new Set(),
    stats: { tokens: {} },
  }
}

function mapCopilotEvent(event: SessionEvent, state: RunState): AgentEvent[] {
  const ts = Date.now()

  switch (event.type) {
    case "session.error":
      state.hasError = true
      state.errorMessage = event.data.message
      return [
        {
          type: "error",
          timestamp: ts,
          data: {
            code: "PROVIDER_ERROR" as ErrorCode,
            message: event.data.message,
            recoverable: false,
          },
        },
      ]

    case "assistant.message_delta":
      if (!state.messageId) state.messageId = event.data.messageId
      state.messageContent += event.data.deltaContent
      if (!event.data.deltaContent) {
        return []
      }
      return [
        {
          type: "message.delta",
          timestamp: ts,
          data: { messageId: event.data.messageId, delta: event.data.deltaContent },
        },
      ]

    case "assistant.message":
      if (!state.messageId) state.messageId = event.data.messageId
      state.messageContent = event.data.content
      if (!event.data.content) {
        return []
      }
      return [
        {
          type: "message.completed",
          timestamp: ts,
          data: { messageId: event.data.messageId, content: event.data.content },
        },
      ]

    case "assistant.reasoning_delta":
      state.reasoningContent += event.data.deltaContent
      if (!event.data.deltaContent) {
        return []
      }
      return [
        {
          type: "reasoning.delta",
          timestamp: ts,
          data: { delta: event.data.deltaContent },
        },
      ]

    case "assistant.reasoning":
      if (!event.data.content) {
        return []
      }
      return [
        {
          type: "reasoning.completed",
          timestamp: ts,
          data: { content: event.data.content },
        },
      ]

    case "tool.execution_start": {
      if (event.data.toolName === "report_intent") {
        state.ignoredToolIds.add(event.data.toolCallId)
        return []
      }

      const activeTool = buildCopilotActiveTool(event.data)
      state.activeTools.set(event.data.toolCallId, activeTool)
      state.stats.toolCalls = (state.stats.toolCalls ?? 0) + 1
      return [
        createToolStartedEvent(event.data.toolCallId, activeTool, ts),
        { type: "stats.updated", timestamp: ts, data: state.stats },
      ]
    }

    case "tool.execution_partial_result":
      if (state.ignoredToolIds.has(event.data.toolCallId)) {
        return []
      }
      return [
        {
          type: "tool.progress",
          timestamp: ts,
          data: {
            toolId: event.data.toolCallId,
            message: event.data.partialOutput,
          },
        },
      ]

    case "tool.execution_progress":
      if (state.ignoredToolIds.has(event.data.toolCallId)) {
        return []
      }
      return [
        {
          type: "tool.progress",
          timestamp: ts,
          data: {
            toolId: event.data.toolCallId,
            message: event.data.progressMessage,
          },
        },
      ]

    case "tool.execution_complete": {
      if (state.ignoredToolIds.delete(event.data.toolCallId)) {
        return []
      }

      const activeTool = state.activeTools.get(event.data.toolCallId) ?? buildUnknownActiveTool()
      state.activeTools.delete(event.data.toolCallId)
      return [createToolCompletedEvent(event.data.toolCallId, activeTool, event.data, ts)]
    }

    case "assistant.usage": {
      const prevOutput = state.stats.tokens?.output ?? 0
      const newOutput = prevOutput + (event.data.outputTokens ?? 0)
      const newInput = event.data.inputTokens ?? state.stats.tokens?.input ?? 0
      state.stats.tokens = {
        input: newInput,
        output: newOutput,
        total: newInput + newOutput,
      }
      state.stats.costUsd = event.data.cost
      state.stats.durationMs = event.data.duration
      return [{ type: "stats.updated", timestamp: ts, data: state.stats }]
    }

    case "session.usage_info":
      state.stats.context = {
        contextSize: event.data.tokenLimit,
        usedTokens: event.data.currentTokens,
      }
      return [{ type: "stats.updated", timestamp: ts, data: state.stats }]

    default:
      return []
  }
}

function createToolStartedEvent(
  toolId: string,
  activeTool: ActiveTool,
  timestamp: number,
): AgentEvent {
  switch (activeTool.toolType) {
    case "shell":
      return {
        type: "tool.started",
        timestamp,
        data: { toolId, toolType: "shell", details: activeTool.details },
      }
    case "file":
      return {
        type: "tool.started",
        timestamp,
        data: { toolId, toolType: "file", details: activeTool.details },
      }
    case "mcp":
      return {
        type: "tool.started",
        timestamp,
        data: { toolId, toolType: "mcp", details: activeTool.details },
      }
    case "web":
      return {
        type: "tool.started",
        timestamp,
        data: { toolId, toolType: "web", details: activeTool.details },
      }
    case "other":
      return {
        type: "tool.started",
        timestamp,
        data: { toolId, toolType: "other", details: activeTool.details },
      }
  }
}

function createToolCompletedEvent(
  toolId: string,
  activeTool: ActiveTool,
  data: CopilotToolCompleteData,
  timestamp: number,
): AgentEvent {
  switch (activeTool.toolType) {
    case "shell":
      return {
        type: "tool.completed",
        timestamp,
        data: {
          toolId,
          toolType: "shell",
          success: data.success,
          details: completeCopilotShellTool(activeTool, data),
        },
      }
    case "file":
      return {
        type: "tool.completed",
        timestamp,
        data: {
          toolId,
          toolType: "file",
          success: data.success,
          details: completeCopilotFileTool(activeTool, data),
        },
      }
    case "mcp":
      return {
        type: "tool.completed",
        timestamp,
        data: {
          toolId,
          toolType: "mcp",
          success: data.success,
          details: completeCopilotMcpTool(activeTool, data),
        },
      }
    case "web":
      return {
        type: "tool.completed",
        timestamp,
        data: {
          toolId,
          toolType: "web",
          success: data.success,
          details: completeCopilotWebTool(activeTool, data),
        },
      }
    case "other":
      return {
        type: "tool.completed",
        timestamp,
        data: {
          toolId,
          toolType: "other",
          success: data.success,
          details: completeCopilotOtherTool(activeTool, data),
        },
      }
  }
}

function buildCopilotActiveTool(data: CopilotToolStartData): ActiveTool {
  if (data.mcpServerName) {
    return buildCopilotMcpTool(data)
  }
  if (isWebFetchTool(data)) {
    return buildCopilotWebTool(data)
  }
  if (isFileMutationTool(data)) {
    return buildCopilotFileMutationTool(data)
  }
  if (isFileViewTool(data)) {
    return buildCopilotFileViewTool(data)
  }
  if (isShellTool(data)) {
    return buildCopilotShellTool(data)
  }
  return buildCopilotOtherTool(data)
}

function buildCopilotMcpTool(data: CopilotToolStartData): ActiveTool {
  return {
    toolType: "mcp",
    details: {
      server: data.mcpServerName ?? "unknown",
      tool: data.mcpToolName ?? data.toolName,
      arguments: data.arguments,
    },
  }
}

function buildCopilotShellTool(data: CopilotToolStartData): ActiveTool {
  return {
    toolType: "shell",
    details: {
      command: getCommandArgument(data.arguments),
    },
  }
}

function buildCopilotWebTool(data: CopilotToolStartData): ActiveTool {
  const url = getStringArgument(data.arguments, "url")
  return {
    toolType: "web",
    details: url ? { action: "open", url } : { action: "other", input: data.arguments },
  }
}

function buildCopilotFileMutationTool(data: CopilotToolStartData): ActiveTool {
  return {
    toolType: "file",
    details: {
      operations: [
        { path: getFilePathArgument(data.arguments), kind: getFileOperationKind(data.toolName) },
      ],
    },
  }
}

function buildCopilotFileViewTool(data: CopilotToolStartData): ActiveTool {
  return {
    toolType: "file",
    details: {
      operations: [{ path: getFilePathArgument(data.arguments), kind: "view" }],
    },
  }
}

function buildCopilotOtherTool(data: CopilotToolStartData): ActiveTool {
  return {
    toolType: "other",
    details: {
      name: data.toolName,
      input: data.arguments,
    },
  }
}

function buildUnknownActiveTool(): ActiveTool {
  return {
    toolType: "other",
    details: { name: "unknown" },
  }
}

function completeCopilotMcpTool(
  activeTool: Extract<ActiveTool, { toolType: "mcp" }>,
  data: CopilotToolCompleteData,
): McpToolCompletedDetails {
  return {
    ...activeTool.details,
    result: data.result,
    error: data.error,
    errorMessage: data.error?.message,
  }
}

function completeCopilotShellTool(
  activeTool: Extract<ActiveTool, { toolType: "shell" }>,
  data: CopilotToolCompleteData,
): ShellToolCompletedDetails {
  return {
    ...activeTool.details,
    output: data.result?.content ?? data.error?.message,
    exitCode: getTerminalExitCode(data),
  }
}

function completeCopilotWebTool(
  activeTool: Extract<ActiveTool, { toolType: "web" }>,
  data: CopilotToolCompleteData,
): WebToolCompletedDetails {
  return {
    ...activeTool.details,
    output: data.result?.content,
    errorMessage: data.error?.message,
  }
}

function completeCopilotFileTool(
  activeTool: Extract<ActiveTool, { toolType: "file" }>,
  data: CopilotToolCompleteData,
): FileToolCompletedDetails {
  return {
    ...activeTool.details,
    output: data.result?.content,
    errorMessage: data.error?.message,
  }
}

function completeCopilotOtherTool(
  activeTool: Extract<ActiveTool, { toolType: "other" }>,
  data: CopilotToolCompleteData,
): OtherToolCompletedDetails {
  return { ...activeTool.details, output: data.result ?? data.error }
}

function isWebFetchTool(data: CopilotToolStartData): boolean {
  return data.toolName === "web_fetch"
}

function isFileMutationTool(data: CopilotToolStartData): boolean {
  return ["create", "edit", "delete"].includes(data.toolName)
}

function isFileViewTool(data: CopilotToolStartData): boolean {
  return data.toolName === "view"
}

function isShellTool(data: CopilotToolStartData): boolean {
  return getCommandArgument(data.arguments).length > 0
}

function getCommandArgument(argumentsValue: Record<string, unknown> | undefined): string {
  if (!argumentsValue) {
    return ""
  }
  const command = argumentsValue.command ?? argumentsValue.cmd ?? argumentsValue.script
  return typeof command === "string" ? command : ""
}

function getStringArgument(
  argumentsValue: Record<string, unknown> | undefined,
  name: string,
): string {
  const value = argumentsValue?.[name]
  return typeof value === "string" ? value : ""
}

function getFilePathArgument(argumentsValue: Record<string, unknown> | undefined): string {
  return getStringArgument(argumentsValue, "path") || getStringArgument(argumentsValue, "filePath")
}

function getFileOperationKind(toolName: string): "add" | "update" | "delete" {
  if (toolName === "create") {
    return "add"
  }
  if (toolName === "delete") {
    return "delete"
  }
  return "update"
}

function getTerminalExitCode(data: CopilotToolCompleteData): number | null {
  const terminalContent = data.result?.contents?.find((content) => content.type === "terminal")
  return terminalContent?.exitCode ?? null
}

function createErrorEvent(code: ErrorCode, message: string): AgentEvent {
  return {
    type: "error",
    timestamp: Date.now(),
    data: {
      code,
      message,
      recoverable: false,
    },
  }
}

// ============================================
// RUN HELPERS
// ============================================

function buildPrompt<T>(options: RunOptions<T>): string {
  const parts = [renderMessages(options.messages)]

  if (options?.outputSchema) {
    const schema = options.outputSchema.toJSONSchema()
    parts.push(`<message role="user">
You MUST reply a json string using the following schema:
${JSON.stringify(schema, null, 2)}

Do NOT use code blocks, DO NOT wrap the JSON in triple backticks or any markup, and DO NOT include any additional text, explanation or reasoning. Return only a single valid JSON string that conforms to the schema.
</message>`)
  }

  return parts.join("\n\n")
}

const formatParseError = (error: Error): AgentEvent =>
  createErrorEvent("PARSE_ERROR", `Failed to parse output: ${error.message}`)

// ============================================
// COPILOT AGENT
// ============================================

// approveAll from @github/copilot-sdk returns { kind: "approved" } but the CLI's Ej()
// only handles "approve-once" / "approve-for-session" / "approve-for-location" — passing
// "approved" hits the default case and throws "unexpected user permission response".
// Using "approve-once" matches what the CLI interactive prompt layer expects.
const approveOnce = (() => ({ kind: "approve-once" })) as unknown as PermissionHandler

function getPermissionHandler(config: CopilotAgentConfig): PermissionHandler {
  return config.providerOptions?.onPermissionRequest ?? approveOnce
}

function translateMcpServers(
  servers?: Record<string, McpServerConfig>,
): Record<string, CopilotMcpServerConfig> | undefined {
  if (!servers) {
    return undefined
  }

  const translatedServers: Record<string, CopilotMcpServerConfig> = {}
  for (const [name, server] of Object.entries(servers)) {
    if (!server.enabled) continue
    translatedServers[name] = translateMcpServer(server)
  }
  return Object.keys(translatedServers).length > 0 ? translatedServers : undefined
}

function translateMcpServer(server: McpServerConfig): CopilotMcpServerConfig {
  const tools = server.tools
  if ("url" in server) {
    return { type: server.type, url: server.url, headers: server.headers, tools }
  }
  return { command: server.command, args: server.args ?? [], env: server.env, tools }
}

export function createCopilotAgent(config: CopilotAgentConfig): Agent {
  const { onPermissionRequest, ...clientOptions } = config.providerOptions ?? {}
  const client = new CopilotClient({
    ...clientOptions,
    cwd: config.cwd,
    env: config.env,
  })

  function run<T = string>(options: RunOptions<T>): RunHandle<T> {
    const state = createRunState()
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    const events = runSession(options, state, resolve, reject)

    return runWithEvents(events, promise, reject)
  }

  async function* runSession<T>(
    options: RunOptions<T>,
    state: RunState,
    resolve: (output: T) => void,
    reject: (error: Error) => void,
  ): AsyncGenerator<AgentEvent, void> {
    const emitRawEvents = options?.emitRawEvents ?? false

    try {
      const session = await client.createSession({
        model: config.model,
        onPermissionRequest: getPermissionHandler(config),
        workingDirectory: config.cwd,
        streaming: options?.streaming ?? false,
        mcpServers: translateMcpServers(config.mcpServers),
        ...(config.skillDirectories && { skillDirectories: config.skillDirectories }),
      })

      const prompt = buildPrompt(options)

      const events = subscriptionToAsyncGenerator<SessionEvent>({
        subscribe: (listener) => session.on(listener),
        stopWhen: (event) => event.type === "session.idle" || event.type === "session.error",
        abortSignal: options?.abortSignal,
        onAbort: () => session.abort(),
      })

      await session.send({ prompt })

      for await (const event of events) {
        if (emitRawEvents) {
          const rawEvent: RawEvent<SessionEvent> = {
            type: "raw",
            timestamp: Date.now(),
            provider: "copilot",
            data: event,
          }
          yield rawEvent
        }

        const mapped = mapCopilotEvent(event, state)
        for (const item of mapped) {
          yield item
        }
      }

      state.stats.durationMs = Date.now() - state.startTime
      yield { type: "stats.updated", timestamp: Date.now(), data: state.stats }

      if (state.hasError) {
        const error = new Error(state.errorMessage ?? "Agent session failed with error")
        reject(error)
        return
      }

      const result = tryParseOutput<T>(state.messageContent, options.outputSchema, formatParseError)
      if (!result.ok) {
        yield result.event
        reject(result.error)
        return
      }

      resolve(result.output)
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      yield createErrorEvent("PROVIDER_ERROR", error.message)
      reject(error)
    }
  }

  async function close(): Promise<void> {
    await client.stop()
  }

  return { provider: config.provider, model: config.model, run, close }
}
