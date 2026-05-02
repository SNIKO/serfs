import type { ParsedPrompt } from "./prompt.types.ts"

const VAR_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g

export function renderPrompt(parsed: ParsedPrompt, vars: Record<string, string>): string {
  const missing: string[] = []
  for (const name of parsed.referencedVars) {
    if (!(name in vars)) missing.push(name)
  }
  if (missing.length > 0) {
    throw new Error(`Missing prompt variables: ${missing.join(", ")}`)
  }

  return parsed.body.replace(VAR_RE, (_, name: string) => vars[name])
}
