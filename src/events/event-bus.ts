import type { SerfsEvent, SerfsEventType } from "./event.types.ts"

type Listener = (event: SerfsEvent) => void
type Wildcard = "*"

export interface EventBus {
  on(type: SerfsEventType | Wildcard, listener: Listener): () => void
  emit(event: SerfsEvent): void
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Listener>>()

  function getBucket(type: string): Set<Listener> {
    let bucket = listeners.get(type)
    if (!bucket) {
      bucket = new Set()
      listeners.set(type, bucket)
    }
    return bucket
  }

  function dispatch(bucket: Set<Listener> | undefined, event: SerfsEvent) {
    if (!bucket) return
    for (const listener of bucket) {
      try {
        listener(event)
      } catch (err) {
        console.error("[serfs] event listener threw:", err)
      }
    }
  }

  return {
    on(type, listener) {
      const bucket = getBucket(type)
      bucket.add(listener)
      return () => bucket.delete(listener)
    },

    emit(event) {
      dispatch(listeners.get(event.type), event)
      dispatch(listeners.get("*"), event)
    },
  }
}
