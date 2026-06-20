import { expect, test } from "bun:test"
import type { Flow } from "../flows/index.ts"
import { validateConfig } from "./config.ts"

const flow = (id: string): Flow =>
  ({
    id,
    config: { workspaceDir: "/" },
    fetchJobs: async () => [],
    getJobId: () => "",
    isRunnable: async () => true,
    run: async () => {},
  }) satisfies Flow

test("returns normalized config when valid", () => {
  const cfg = validateConfig({
    maxConcurrentJobs: 4,
    flows: [flow("a")],
  })
  expect(cfg.maxConcurrentJobs).toBe(4)
  expect(cfg.flows).toHaveLength(1)
  expect(cfg.dashboard.enabled).toBe(true)
  expect(cfg.dashboard.port).toBe(4000)
})

test("throws when maxConcurrentJobs is non-positive", () => {
  expect(() =>
    validateConfig({
      maxConcurrentJobs: 0,
      flows: [flow("a")],
    }),
  ).toThrow(/maxConcurrentJobs/)
})

test("throws on duplicate flow ids", () => {
  expect(() =>
    validateConfig({
      maxConcurrentJobs: 1,
      flows: [flow("a"), flow("a")],
    }),
  ).toThrow(/duplicate/i)
})

test("throws when no flows are registered", () => {
  expect(() =>
    validateConfig({
      maxConcurrentJobs: 1,
      flows: [],
    }),
  ).toThrow(/at least one flow/i)
})

test("dashboard.enabled=false disables dashboard", () => {
  const cfg = validateConfig({
    maxConcurrentJobs: 1,
    flows: [flow("a")],
    dashboard: { enabled: false },
  })
  expect(cfg.dashboard.enabled).toBe(false)
})
