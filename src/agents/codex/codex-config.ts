import type { CodexOptions, ThreadOptions as CodexThreadOptions } from "@openai/codex-sdk"

import type { CodexAgentConfig, CodexProviderOptions, McpServerConfig } from "../types.ts"

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject

type CodexConfigObject = {
  [key: string]: CodexConfigValue
}

export function buildCodexOptions(agentConfig: CodexAgentConfig): CodexOptions {
  const userProvidedCodexOptions: CodexProviderOptions = agentConfig.codexOptions ?? {}
  const shellPath = agentConfig.env?.PATH ?? userProvidedCodexOptions.env?.PATH ?? process.env.PATH
  const codexConfig = buildCodexConfig(
    userProvidedCodexOptions.config,
    agentConfig.mcpServers,
    shellPath,
  )

  return {
    codexPathOverride: userProvidedCodexOptions.codexPathOverride,
    baseUrl: userProvidedCodexOptions.baseUrl,
    apiKey: userProvidedCodexOptions.apiKey,
    env: buildCodexEnv(agentConfig.env, userProvidedCodexOptions.env),
    config: hasObjectKeys(codexConfig) ? codexConfig : undefined,
  }
}

export function buildCodexThreadOptions(agentConfig: CodexAgentConfig): CodexThreadOptions {
  const providerOptions: CodexProviderOptions = agentConfig.codexOptions ?? {}

  return {
    sandboxMode: providerOptions.sandboxMode,
    skipGitRepoCheck: providerOptions.skipGitRepoCheck,
    modelReasoningEffort: providerOptions.modelReasoningEffort,
    networkAccessEnabled: providerOptions.networkAccessEnabled,
    webSearchMode: providerOptions.webSearchMode,
    webSearchEnabled: providerOptions.webSearchEnabled,
    approvalPolicy: providerOptions.approvalPolicy,
    additionalDirectories: providerOptions.additionalDirectories,
    model: agentConfig.model ?? providerOptions.model,
    workingDirectory: agentConfig.cwd ?? providerOptions.workingDirectory,
  }
}

function buildCodexEnv(
  agentEnv?: Record<string, string>,
  codexEnv?: Record<string, string>,
): Record<string, string> | undefined {
  if (!agentEnv && !codexEnv) {
    return undefined
  }

  return { ...getProcessEnv(), ...codexEnv, ...agentEnv }
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

function buildCodexConfig(
  userProvidedCodexConfig?: CodexConfigObject,
  mcpServers?: Record<string, McpServerConfig>,
  shellPath?: string,
): CodexConfigObject {
  const mergedCodexConfig: CodexConfigObject = {
    ...(userProvidedCodexConfig ?? {}),
    approvals_reviewer: userProvidedCodexConfig?.approvals_reviewer ?? "auto_review",
  }

  if (shellPath) {
    mergedCodexConfig.shell_environment_policy = buildShellEnvironmentPolicy(
      userProvidedCodexConfig?.shell_environment_policy,
      shellPath,
    )
  }

  if (mcpServers) {
    mergedCodexConfig.mcp_servers = translateMcpServers(mcpServers)
  } else if (userProvidedCodexConfig?.mcp_servers !== undefined) {
    mergedCodexConfig.mcp_servers = userProvidedCodexConfig.mcp_servers
  }

  return mergedCodexConfig
}

function buildShellEnvironmentPolicy(
  providerPolicy: CodexConfigValue | undefined,
  shellPath: string,
): CodexConfigObject {
  const policy = isCodexConfigObject(providerPolicy) ? { ...providerPolicy } : {}
  const providerSet = policy.set
  const set = isCodexConfigObject(providerSet) ? providerSet : {}
  return { ...policy, set: { PATH: shellPath, ...set } }
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

function isCodexConfigObject(value: CodexConfigValue | undefined): value is CodexConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasObjectKeys(value: CodexConfigObject): boolean {
  return Object.keys(value).length > 0
}
