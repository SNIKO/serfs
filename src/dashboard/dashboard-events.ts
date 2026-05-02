import type { EventBus, SerfsEvent } from "../events/index.ts"

const MAX_BUFFER = 1000

export interface SseStreamArgs {
  events: EventBus
  filter?: (event: SerfsEvent) => boolean
}

export function createSseStream(args: SseStreamArgs): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buffered = 0
      const encoder = new TextEncoder()

      const off = args.events.on("*", (event) => {
        if (args.filter && !args.filter(event)) return
        if (buffered >= MAX_BUFFER) {
          controller.error(new Error("SSE buffer overflow"))
          off()
          return
        }
        const line = `data: ${JSON.stringify(event)}\n\n`
        try {
          controller.enqueue(encoder.encode(line))
          buffered++
        } catch {
          off()
        }
      })

      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          clearInterval(beat)
          off()
        }
      }, 15_000)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}
