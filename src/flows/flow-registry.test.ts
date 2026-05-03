import { expect, test } from "bun:test"
import type { Flow } from "./flow.types.ts"
import { createFlowRegistry } from "./flow-registry.ts"

const stub = (id: string): Flow =>
  ({
    id,
    config: { workspaceDir: "/" },
    fetchJobs: async () => [],
    getJobId: () => "",
    isRunnable: async () => true,
    run: async () => {},
  }) satisfies Flow

test("register and retrieve a flow by id", () => {
  const reg = createFlowRegistry()
  const f = stub("incidents")
  reg.register(f)
  expect(reg.get("incidents")).toBe(f)
})

test("registering a duplicate id throws", () => {
  const reg = createFlowRegistry()
  reg.register(stub("a"))
  expect(() => reg.register(stub("a"))).toThrow(/duplicate/i)
})

test("list returns all registered flows", () => {
  const reg = createFlowRegistry()
  reg.register(stub("a"))
  reg.register(stub("b"))
  expect(
    reg
      .list()
      .map((f) => f.id)
      .sort(),
  ).toEqual(["a", "b"])
})

test("get returns undefined for an unregistered id", () => {
  const reg = createFlowRegistry()
  expect(reg.get("nope")).toBeUndefined()
})
