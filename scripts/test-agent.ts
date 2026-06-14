#!/usr/bin/env bun

import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import type { Agent, AgentEvent } from "../src/agents/index.ts"
import { createAgent } from "../src/agents/index.ts"

async function main(): Promise<void> {
  const agent = createCodexAgent()

  try {
    const handle = agent.run({
      messages: [{ role: "user", content: "What MCP tools and skills do you have?" }],
      emitRawEvents: false,
    })

    await prepareJsonlLog("agent-events.jsonl")

    for await (const event of handle) {
      await logJsonlEvent("agent-events.jsonl", event)
      printEvent(event)
    }

    const output = await handle.output
    console.log("\n=== OUTPUT ===")
    console.log(output)
  } finally {
    await agent.close()
  }
}

function createCodexAgent(): Agent {
  const agent = createAgent({
    provider: "codex",
    model: "gpt-5.4-mini",
    env: {
      CODEX_HOME: `${process.cwd()}/.codex`,
    },
    mcpServers: {
      yfinance: {
        enabled: true,
        command: "uvx",
        tools: [],
        args: [
          "--from",
          "git+https://github.com/Alex2Yang97/yahoo-finance-mcp",
          "yahoo-finance-mcp",
        ],
      },
    },
    providerOptions: {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      modelReasoningEffort: "low",
    },
  })

  return agent
}

async function prepareJsonlLog(path: string | undefined): Promise<void> {
  if (!path) {
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, "")
}

async function logJsonlEvent(path: string | undefined, event: AgentEvent): Promise<void> {
  if (!path) {
    return
  }
  await appendFile(path, `${JSON.stringify(event)}\n`)
}

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "message.delta":
      process.stdout.write(event.data.delta)
      return
    case "message.completed":
      console.log("\n[message.completed]")
      return
    case "reasoning.delta":
      process.stderr.write(event.data.delta)
      return
    case "tool.started":
      console.log(`\n[tool.started] ${event.data.name}`)
      return
    case "tool.progress":
      process.stdout.write(event.data.message)
      return
    case "tool.completed":
      console.log(`\n[tool.completed] ${event.data.name} success=${event.data.success}`)
      if (event.data.error) {
        console.error(event.data.error)
      }
      return
    case "file.changed":
      console.log(`\n[file.changed] ${event.data.changes.length} change(s)`)
      return
    case "stats.updated":
      console.log(`\n[stats.updated] ${JSON.stringify(event.data)}`)
      return
    case "error":
      console.error(`\n[error] ${event.data.code}: ${event.data.message}`)
      return
    case "raw":
      console.log(`\n[raw] ${JSON.stringify(event.data)}`)
      return
    default:
      console.log(`\n[event] ${event.type}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Agent test failed: ${message}`)
  process.exit(1)
})
