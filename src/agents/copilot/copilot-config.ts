import type {
  CopilotClientOptions,
  MCPServerConfig as CopilotMcpServerConfig,
  PermissionHandler,
  SessionConfig,
} from "@github/copilot-sdk"

import { renderMessages } from "../agent.ts"
import type { CopilotAgentConfig, McpServerConfig, RunOptions } from "../types.ts"

// approveAll from @github/copilot-sdk returns { kind: "approved" } but the CLI's Ej()
// only handles "approve-once" / "approve-for-session" / "approve-for-location" - passing
// "approved" hits the default case and throws "unexpected user permission response".
// Using "approve-once" matches what the CLI interactive prompt layer expects.
const approveOnce = (() => ({ kind: "approve-once" })) as unknown as PermissionHandler

const COPILOT_CLIENT_OPTION_KEYS = [
  "cliArgs",
  "cliPath",
  "cliUrl",
  "port",
  "useStdio",
  "autoRestart",
  "autoStart",
  "githubToken",
  "isChildProcess",
  "logLevel",
  "useLoggedInUser",
] satisfies (keyof CopilotClientOptions)[]

const COPILOT_SESSION_OPTION_KEYS = [
  "availableTools",
  "clientName",
  "configDir",
  "customAgents",
  "disabledSkills",
  "excludedTools",
  "hooks",
  "infiniteSessions",
  "mcpServers",
  "model",
  "onPermissionRequest",
  "onUserInputRequest",
  "provider",
  "reasoningEffort",
  "sessionId",
  "skillDirectories",
  "streaming",
  "systemMessage",
  "tools",
  "workingDirectory",
] satisfies (keyof SessionConfig)[]

export function buildCopilotClientOptions(config: CopilotAgentConfig): CopilotClientOptions {
  const clientOptions = config.copilotOptions
    ? pickDefinedOptions(config.copilotOptions, COPILOT_CLIENT_OPTION_KEYS)
    : {}

  return {
    ...clientOptions,
    cwd: config.cwd ?? config.copilotOptions?.cwd,
    env: config.env ?? config.copilotOptions?.env,
  }
}

export function buildCopilotSessionOptions<T>(
  config: CopilotAgentConfig,
  options: RunOptions<T>,
): SessionConfig {
  const sessionOptions = buildProviderSessionOptions(config.copilotOptions)

  return {
    ...sessionOptions,
    model: config.model ?? sessionOptions.model,
    onPermissionRequest: config.copilotOptions?.onPermissionRequest ?? approveOnce,
    workingDirectory: config.cwd ?? sessionOptions.workingDirectory,
    streaming: options.streaming ?? sessionOptions.streaming,
    mcpServers: config.mcpServers
      ? translateMcpServers(config.mcpServers)
      : sessionOptions.mcpServers,
  }
}

export function buildCopilotPrompt<T>(options: RunOptions<T>): string {
  const parts = [renderMessages(options.messages)]

  if (options.outputSchema) {
    const schema = options.outputSchema.toJSONSchema()
    parts.push(`<output_contract>
The final assistant message MUST be exactly one valid JSON value that conforms to this JSON Schema.

JSON Schema:
${JSON.stringify(schema, null, 2)}

Rules:
- Output only the JSON value.
- Do not wrap it in markdown or code fences.
- Do not include explanations, comments, reasoning, headings, or surrounding text.
- The entire assistant message must be parseable by JSON.parse.
- Use double-quoted JSON property names and string values.
- Do not include properties not allowed by the schema.
</output_contract>`)
  }

  return parts.join("\n\n")
}

function buildProviderSessionOptions(
  providerOptions: CopilotAgentConfig["copilotOptions"],
): Partial<SessionConfig> {
  if (!providerOptions) {
    return {}
  }

  return pickDefinedOptions(providerOptions, COPILOT_SESSION_OPTION_KEYS)
}

function pickDefinedOptions<TSource extends object, TKey extends keyof TSource>(
  source: TSource,
  keys: readonly TKey[],
): Partial<Pick<TSource, TKey>> {
  const options: Partial<Pick<TSource, TKey>> = {}

  for (const key of keys) {
    const value = source[key]
    if (value !== undefined) {
      options[key] = value
    }
  }

  return options
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
