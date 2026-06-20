import { Codex, type TurnOptions as CodexTurnOptions } from "@openai/codex-sdk"

import { renderMessages, runWithEvents, tryParseOutput } from "../agent.ts"
import type { Agent, AgentEvent, CodexAgentConfig, RunHandle, RunOptions } from "../types.ts"
import { buildCodexOptions, buildCodexThreadOptions } from "./codex-config.ts"
import {
  createErrorEvent,
  createRawEvent,
  createRunError,
  createRunState,
  formatParseError,
  getErrorCode,
  mapCodexEvent,
  type RunState,
} from "./codex-events.ts"

interface CodexRunContext {
  codexClient: Codex
  config: CodexAgentConfig
}

export function createCodexAgent(config: CodexAgentConfig): Agent {
  const codexClient = new Codex(buildCodexOptions(config))

  return {
    provider: config.provider,
    model: config.model,
    run: (options) => runCodexAgent(options, { codexClient, config }),
    close: closeCodexAgent,
  }
}

function runCodexAgent<T = string>(options: RunOptions<T>, context: CodexRunContext): RunHandle<T> {
  const state = createRunState()
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const events = streamCodexThreadEvents(options, state, context, resolve, reject)

  return runWithEvents(events, promise, reject)
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
