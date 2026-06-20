import { CopilotClient, type SessionEvent } from "@github/copilot-sdk"

import { subscriptionToAsyncGenerator } from "../../utils/subscription.ts"
import { runWithEvents, tryParseOutput } from "../agent.ts"
import type { Agent, AgentEvent, CopilotAgentConfig, RunHandle, RunOptions } from "../types.ts"
import {
  buildCopilotClientOptions,
  buildCopilotPrompt,
  buildCopilotSessionOptions,
} from "./copilot-config.ts"
import {
  createErrorEvent,
  createRawEvent,
  createRunError,
  createRunState,
  formatParseError,
  mapCopilotEvent,
  type RunState,
} from "./copilot-events.ts"

interface CopilotRunContext {
  client: CopilotClient
  config: CopilotAgentConfig
}

export function createCopilotAgent(config: CopilotAgentConfig): Agent {
  const client = new CopilotClient(buildCopilotClientOptions(config))

  return {
    provider: config.provider,
    model: config.model,
    run: (options) => runCopilotAgent(options, { client, config }),
    close: () => closeCopilotAgent(client),
  }
}

function runCopilotAgent<T = string>(
  options: RunOptions<T>,
  context: CopilotRunContext,
): RunHandle<T> {
  const state = createRunState()
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const events = streamCopilotSessionEvents(options, state, context, resolve, reject)

  return runWithEvents(events, promise, reject)
}

async function* streamCopilotSessionEvents<T>(
  options: RunOptions<T>,
  state: RunState,
  context: CopilotRunContext,
  resolve: (output: T) => void,
  reject: (error: Error) => void,
): AsyncGenerator<AgentEvent, void> {
  try {
    yield* runCopilotSession(options, state, context)
    yield* finishCopilotRun(options, state, resolve, reject)
  } catch (error) {
    const err = createRunError(error)
    yield createErrorEvent("PROVIDER_ERROR", err.message)
    reject(err)
  }
}

async function* runCopilotSession<T>(
  options: RunOptions<T>,
  state: RunState,
  context: CopilotRunContext,
): AsyncGenerator<AgentEvent, void> {
  const { client, config } = context
  const emitRawEvents = options.emitRawEvents ?? false
  const session = await client.createSession(buildCopilotSessionOptions(config, options))
  const events = subscriptionToAsyncGenerator<SessionEvent>({
    subscribe: (listener) => session.on(listener),
    stopWhen: (event) => event.type === "session.idle" || event.type === "session.error",
    abortSignal: options.abortSignal,
    onAbort: () => session.abort(),
  })

  await session.send({ prompt: buildCopilotPrompt(options) })

  for await (const event of events) {
    if (emitRawEvents) {
      yield createRawEvent(event)
    }

    for (const mappedEvent of mapCopilotEvent(event, state)) {
      yield mappedEvent
    }
  }
}

async function* finishCopilotRun<T>(
  options: RunOptions<T>,
  state: RunState,
  resolve: (output: T) => void,
  reject: (error: Error) => void,
): AsyncGenerator<AgentEvent, void> {
  state.stats.durationMs = Date.now() - state.startTime
  yield { type: "stats.updated", timestamp: Date.now(), data: state.stats }

  if (state.hasError) {
    reject(new Error(state.errorMessage ?? "Agent session failed with error"))
    return
  }

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

async function closeCopilotAgent(client: CopilotClient): Promise<void> {
  await client.stop()
}
