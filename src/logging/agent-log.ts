import { createWriteStream, type WriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { AgentEvent } from "../agents/index.ts"

export interface AgentLog {
  write(event: AgentEvent): Promise<void>
  close(): Promise<void>
}

export async function createAgentLog(filePath: string): Promise<AgentLog> {
  await mkdir(dirname(filePath), { recursive: true })
  const stream: WriteStream = createWriteStream(filePath, { flags: "a" })
  let closed = false

  return {
    async write(event) {
      if (closed) return
      const line = `${JSON.stringify(event)}\n`
      await new Promise<void>((resolve) => {
        stream.write(line, (err) => {
          if (err) {
            console.error("[serfs] agent log write failed:", err)
          }
          resolve()
        })
      })
    },

    async close() {
      if (closed) return
      closed = true
      await new Promise<void>((resolve) => {
        stream.end(() => resolve())
      })
    },
  }
}
