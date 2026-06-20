# Agent Wrapper Guidelines

Use this file when creating or updating wrappers under `src/agents/`.

## Goal

Build thin adapters that expose external coding agents through the local `Agent` interface. Keep provider-specific logic inside one wrapper file and normalize provider behavior into the shared event model.

Success criteria:
- `createAgent(config)` can instantiate the provider.
- `agent.run(options)` returns a `RunHandle<T>` via `runWithEvents`.
- Provider output is mapped to local `AgentEvent` values.
- `outputSchema`, `abortSignal`, `cwd`, `env`, `model`, `mcpServers`, and `providerOptions` are supported when the provider supports equivalents.
- `close()` releases resources or is a documented no-op.

## Local contracts

Read these before implementing:
- `./types.ts` — `Agent`, `AgentConfig`, `RunOptions`, `RunHandle`, `AgentEvent`, `McpServerConfig`.
- `./agent.ts` — `renderMessages`, `runWithEvents`, `tryParseOutput`, `stripCodeBlock`.
- `./index.ts` — provider factory wiring.
- Existing wrappers, especially `./codex/codex-agent.ts`, `./codex/codex-config.ts`, `./codex/codex-events.ts`, and `./copilot/`, for local style and mapping patterns.

## Implementation rules

- Use officeial documentation and codebase (if available) to understand provider behavior, interfaces, APIs, enums, etc.
- Prefer official SDKs over CLI wrappers when SDKs expose streaming, cancellation, tools, or structured output.
- Use CLI/headless mode only when no stable SDK is available.
- Keep wrappers thin: translate API shapes, do not build a second runtime.
- Preserve raw provider events only when `emitRawEvents` is true.
- Resolve the run promise only after provider completion and output parsing succeeds.
- Yield an `error` event and reject on provider errors, aborts, or parse failures.

## Event mapping

Map provider events into the local union:
- Assistant text → `message.delta` / `message.completed`.
- Reasoning or thinking → `reasoning.delta` / `reasoning.completed`.
- Built-in tools → `tool.started`, `tool.progress`, `tool.completed` with `data.toolType` and stage-appropriate `data.details`.
- MCP tools → tool events with `data.toolType: "mcp"` and `data.details.server` / `data.details.tool`.
- File edits → tool events with `data.toolType: "file"` and changed paths in `data.details.changes`.
- Usage, context, cost, or duration → `stats.updated`.
- Failures → `error` with the closest local error code.

## Structured output

- Prefer native JSON Schema / structured output support.
- If unavailable, add a strict JSON-only instruction to the prompt and parse with `tryParseOutput`.
- On parse failure, yield `PARSE_ERROR` and reject.

## MCP

Use local `McpServerConfig` as the source shape and translate inside the wrapper:
- `stdio`: command, args, env, tools.
- `http` / `sse`: url, headers, tools.

## Provider references

### Codex (`codex`)
- Repo: https://github.com/openai/codex
- Non-interactive docs: https://developers.openai.com/codex/noninteractive
- CLI exec docs: https://openai-codex.mintlify.app/cli/exec
- Prefer `@openai/codex-sdk`; see `./codex/codex-agent.ts`, `./codex/codex-config.ts`, and `./codex/codex-events.ts`.

### Claude Code (`claude`)
- Headless / Agent SDK: https://code.claude.com/docs/en/headless
- CLI reference: https://code.claude.com/docs/en/cli-usage
- Markdown docs: https://code.claude.com/docs/en/headless.md and https://code.claude.com/docs/en/cli-reference.md
- Prefer the TypeScript Agent SDK when available; CLI headless mode is `claude -p`.

### GitHub Copilot (`copilot`)
- Product: https://github.com/features/copilot/cli
- About CLI: https://docs.github.com/copilot/concepts/agents/about-copilot-cli
- Usage: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview
- Docs source: https://github.com/github/docs/tree/main/content/copilot
- Prefer `@github/copilot-sdk`; see `./copilot/`.

### OpenCode (`opencode`)
- Docs: https://opencode.ai/docs/
- CLI: https://opencode.ai/docs/cli/
- Repo: https://github.com/anomalyco/opencode
- Docs source: https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/cli.mdx
- Use documented programmatic/headless CLI behavior if no stable SDK is available.

### pi coding agent (`pi`)
- Website: https://pi.dev
- Repo: https://github.com/earendil-works/pi
- SDK docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- Extensions docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- Local docs: `/home/niko/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- Prefer the SDK from `@earendil-works/pi-coding-agent`.

## Checklist

- [ ] Used provider api calls, events, enums exists in the official documentation or the codebase, NEVER guess or infer them.
- [ ] All provider events are properly mapped to local events. If not strictly typed (any, unknown) - check for actual values in the provider codebase.
