import { expect, test } from "bun:test"
import { parsePrompt } from "./prompt-parse.ts"
import { renderPrompt } from "./prompt-render.ts"

test("substitutes referenced variables", () => {
  const parsed = parsePrompt("Hello {{NAME}} from {{PLACE}}")
  expect(renderPrompt(parsed, { NAME: "Ada", PLACE: "Earth" })).toBe("Hello Ada from Earth")
})

test("throws if a referenced variable is missing", () => {
  const parsed = parsePrompt("Need {{REQUIRED}}")
  expect(() => renderPrompt(parsed, {})).toThrow(/REQUIRED/)
})

test("ignores extra variables that aren't referenced", () => {
  const parsed = parsePrompt("Just {{A}}")
  expect(renderPrompt(parsed, { A: "x", B: "ignored" })).toBe("Just x")
})

test("substitutes the same variable in multiple places", () => {
  const parsed = parsePrompt("{{X}} and {{X}}")
  expect(renderPrompt(parsed, { X: "go" })).toBe("go and go")
})
