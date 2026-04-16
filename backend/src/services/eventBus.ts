/**
 * Simple in-process event bus for broadcasting SSE events to connected clients.
 * Each client gets its own AsyncQueue that receives copies of all events.
 */

type EventData = {
  event: string;
  data: string;
};

type Client = {
  id: number;
  queue: Array<EventData>;
  waiters: Array<(event: EventData | null) => void>;
  closed: boolean;
};

class EventBus {
  private clients = new Map<number, Client>();
  private nextId = 0;

  /** Register a new SSE client. Returns a client ID and async iterator. */
  subscribe(): { clientId: number; next: () => Promise<EventData | null> } {
    const id = this.nextId++;
    const client: Client = { id, queue: [], waiters: [], closed: false };
    this.clients.set(id, client);

    return {
      clientId: id,
      next: () => {
        if (client.closed) {
          return Promise.resolve(null);
        }
        const item = client.queue.shift();
        if (item) {
          return Promise.resolve(item);
        }
        return new Promise<EventData | null>((resolve) => {
          client.waiters.push(resolve);
        });
      },
    };
  }

  /** Unsubscribe a client, releasing any pending waiters. */
  unsubscribe(clientId: number): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.closed = true;
      // Resolve any pending waiters with null to unblock them
      for (const waiter of client.waiters) {
        waiter(null);
      }
      client.waiters = [];
      this.clients.delete(clientId);
    }
  }

  /** Broadcast an event to all connected clients. */
  broadcast(event: string, data: Record<string, unknown>): void {
    const payload: EventData = { event, data: JSON.stringify(data) };
    for (const client of this.clients.values()) {
      if (client.closed) {
        continue;
      }
      const waiter = client.waiters.shift();
      if (waiter) {
        waiter(payload);
      } else {
        client.queue.push(payload);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get hasActiveClients(): boolean {
    return this.clients.size > 0;
  }
}

export const eventBus = new EventBus();
