type EventPayload = {
  type: "connected" | "drops:changed" | "heartbeat";
  reason?: string;
  serverTime: number;
  version: number;
};

type Subscriber = {
  id: string;
  send: (payload: EventPayload) => void;
  close: () => void;
};

type EventHub = {
  subscribers: Set<Subscriber>;
  version: number;
};

const encoder = new TextEncoder();
const globalEvents = globalThis as typeof globalThis & {
  __flashDropEventHub?: EventHub;
};

function getHub() {
  if (!globalEvents.__flashDropEventHub) {
    globalEvents.__flashDropEventHub = {
      subscribers: new Set<Subscriber>(),
      version: 0
    };
  }
  return globalEvents.__flashDropEventHub;
}

export function publishDropChange(reason: string) {
  const hub = getHub();
  hub.version += 1;

  const payload: EventPayload = {
    type: "drops:changed",
    reason,
    serverTime: Date.now(),
    version: hub.version
  };

  for (const subscriber of hub.subscribers) {
    subscriber.send(payload);
  }
}

export function createEventStream(signal?: AbortSignal) {
  const hub = getHub();
  const id = crypto.randomUUID();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        hub.subscribers.delete(subscriber);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };

      const subscriber: Subscriber = {
        id,
        send(payload) {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(formatEvent(payload)));
          } catch {
            cleanup();
          }
        },
        close: cleanup
      };

      const heartbeat = setInterval(() => {
        subscriber.send({
          type: "heartbeat",
          serverTime: Date.now(),
          version: hub.version
        });
      }, 25_000);

      hub.subscribers.add(subscriber);
      subscriber.send({
        type: "connected",
        serverTime: Date.now(),
        version: hub.version
      });

      signal?.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      const subscriber = [...hub.subscribers].find((item) => item.id === id);
      subscriber?.close();
    }
  });
}

function formatEvent(payload: EventPayload) {
  const eventName = payload.type === "drops:changed" ? "drops" : "status";
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}
