export interface PromptFrontmatter {
  provider?: string
  model?: string
}

export interface ParsedPrompt {
  frontmatter: PromptFrontmatter
  body: string
  referencedVars: ReadonlySet<string>
}
