import type { ParsedPrompt, PromptFrontmatter } from "./prompt.types.ts"

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/
const VAR_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g
const ALLOWED_KEYS = new Set<keyof PromptFrontmatter>(["provider", "model"])

export function parsePrompt(template: string): ParsedPrompt {
  const { frontmatter, body } = splitFrontmatter(template)
  const referencedVars = collectVars(body)
  return { frontmatter, body: body.trim(), referencedVars }
}

function splitFrontmatter(template: string): {
  frontmatter: PromptFrontmatter
  body: string
} {
  if (!template.startsWith("---")) {
    return { frontmatter: {}, body: template }
  }

  const match = template.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error("Malformed prompt frontmatter: missing closing '---'")
  }

  const frontmatter = parseFrontmatterBody(match[1])
  const body = template.slice(match[0].length)
  return { frontmatter, body }
}

function parseFrontmatterBody(raw: string): PromptFrontmatter {
  const out: PromptFrontmatter = {}
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const colon = trimmed.indexOf(":")
    if (colon === -1) {
      throw new Error(`Malformed prompt frontmatter line: ${line}`)
    }

    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (ALLOWED_KEYS.has(key as keyof PromptFrontmatter)) {
      out[key as keyof PromptFrontmatter] = value
    }
  }
  return out
}

function collectVars(body: string): Set<string> {
  const found = new Set<string>()
  for (const match of body.matchAll(VAR_RE)) {
    found.add(match[1])
  }
  return found
}
