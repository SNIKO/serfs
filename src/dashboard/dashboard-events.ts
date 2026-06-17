import type { EventBus, SerfsEvent } from "../events/index.ts"

const MAX_BUFFER = 1000

export interface SseStreamArgs {
  events: EventBus
  filter?: (event: SerfsEvent) => boolean
}

export function createSseStream(args: SseStreamArgs): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        // Signal to the client that the SSE connection is live and buffering has begun.
        // The client should open this connection first, then fetch REST endpoints, then
        // drain its local buffer — eliminating the race window without server-side replay.
        controller.enqueue(encoder.encode('data: {"type":"stream.ready"}\n\n'))

        const off = args.events.on("*", (event) => {
          // raw events are provider-native pass-throughs; not part of the public API
          if (event.type === "agent.event" && event.event.type === "raw") return
          if (args.filter && !args.filter(event)) return

          // desiredSize < 0 means more than MAX_BUFFER unread chunks are queued
          if ((controller.desiredSize ?? 1) < 0) {
            controller.error(new Error("SSE buffer overflow"))
            off()
            return
          }

          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
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
    },
    new CountQueuingStrategy({ highWaterMark: MAX_BUFFER }),
  )

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
