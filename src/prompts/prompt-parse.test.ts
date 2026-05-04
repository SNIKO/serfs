import { expect, test } from "bun:test"
import { parsePrompt } from "./prompt-parse.ts"

test("parses body without frontmatter", () => {
  const result = parsePrompt("Hello {{NAME}}!")
  expect(result.frontmatter).toEqual({})
  expect(result.body).toBe("Hello {{NAME}}!")
  expect([...result.referencedVars]).toEqual(["NAME"])
})

test("parses provider and model from frontmatter", () => {
  const template = `---
provider: copilot
model: gpt-5.2
---
Investigate {{INCIDENT_ID}}.`
  const result = parsePrompt(template)
  expect(result.frontmatter).toEqual({ provider: "copilot", model: "gpt-5.2" })
  expect(result.body).toBe("Investigate {{INCIDENT_ID}}.")
  expect([...result.referencedVars]).toEqual(["INCIDENT_ID"])
})

test("collects each referenced variable once", () => {
  const result = parsePrompt("{{A}} and {{B}} and {{A}} again")
  expect([...result.referencedVars].sort()).toEqual(["A", "B"])
})

test("ignores unknown frontmatter keys", () => {
  const template = `---
provider: codex
ttl: 100
---
body`
  const result = parsePrompt(template)
  expect(result.frontmatter).toEqual({ provider: "codex" })
})

test("throws on malformed frontmatter (no closing fence)", () => {
  const template = `---
provider: copilot
body without closing`
  expect(() => parsePrompt(template)).toThrow(/frontmatter/i)
})

test("trims surrounding whitespace from body", () => {
  const template = `---
provider: copilot
---

  body
`
  const result = parsePrompt(template)
  expect(result.body).toBe("body")
})

test("treats variable names as upper-case alphanumeric + underscore", () => {
  const result = parsePrompt("{{JOB_DIR}} and {{not_a_var}}")
  expect([...result.referencedVars]).toEqual(["JOB_DIR"])
})
