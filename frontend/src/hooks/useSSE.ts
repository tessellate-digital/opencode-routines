import { useEffect, useRef } from 'react';

type SSEHandler = (event: MessageEvent) => void;

/**
 * Hook to subscribe to the global SSE events stream.
 * Automatically reconnects on disconnect.
 * Calls `onEvent` for every incoming server-sent event.
 */
export function useGlobalSSE(onEvent: SSEHandler) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource('/api/events');

      es.onmessage = (e: MessageEvent) => handlerRef.current(e);

      // Also listen to named event types
      const eventTypes = [
        'run_created',
        'run_started',
        'run_updated',
        'run_finished',
        'run_cancelled',
        'routine_created',
        'routine_updated',
        'routine_deleted',
        'ping',
      ];
      for (const t of eventTypes) {
        es.addEventListener(t, ((e: Event) => {
          handlerRef.current(e as MessageEvent);
        }) as EventListener);
      }

      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, []);
}

/**
 * Hook to subscribe to a single run's SSE stream.
 * Automatically reconnects on disconnect (the backend replays past events
 * so late-joining clients see the full conversation).
 */
export function useRunStream(
  runId: string | null,
  handlers: {
    onText?: (data: string) => void;
    onTool?: (data: string) => void;
    onToolResult?: (data: string) => void;
    onStatus?: (data: string) => void;
    onError?: (data: string) => void;
    onStderr?: (data: string) => void;
    onStdout?: (data: string) => void;
    onDone?: (data: string) => void;
    /** Called before the stream reconnects — clear live state so replayed events rebuild it. */
    onReconnect?: () => void;
    /** Called when the stream cannot be opened after all retries. */
    onStreamError?: () => void;
  }
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!runId) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let retries = 0;
    let stopped = false;
    const MAX_RETRIES = 8;

    function connect() {
      if (stopped) return;

      // On reconnect, signal the frontend to clear live state so the replayed
      // history from the backend rebuilds it cleanly (no duplicates).
      if (retries > 0) {
        handlersRef.current.onReconnect?.();
      }

      es = new EventSource(`/api/runs/${runId}/stream`);

      const eventMap: Record<string, keyof typeof handlers> = {
        text: 'onText',
        tool: 'onTool',
        tool_result: 'onToolResult',
        status: 'onStatus',
        error: 'onError',
        stderr: 'onStderr',
        stdout: 'onStdout',
      };

      for (const [eventType, handlerKey] of Object.entries(eventMap)) {
        es.addEventListener(eventType, ((e: Event) => {
          const me = e as MessageEvent;
          handlersRef.current[handlerKey]?.(me.data);
        }) as EventListener);
      }

      es.addEventListener('done', ((e: Event) => {
        const me = e as MessageEvent;
        // Only treat terminal statuses as a true end-of-stream.  A non-terminal
        // status (e.g. "running") means the stream was interrupted — reconnect
        // with backoff instead of stopping.
        let isTerminal = true;
        try {
          const parsed = JSON.parse(me.data);
          const TERMINAL = ['success', 'failed', 'cancelled', 'lost'];
          isTerminal = TERMINAL.includes(parsed.status);
        } catch {
          // If we can't parse, treat as terminal to avoid infinite loops
        }

        if (isTerminal) {
          retries = 0;
          stopped = true;
          handlersRef.current.onDone?.(me.data);
          es?.close();
        } else {
          // Non-terminal done — treat as stream interruption, reconnect
          es?.close();
          if (!stopped) {
            retries++;
            if (retries > MAX_RETRIES) {
              handlersRef.current.onStreamError?.();
              return;
            }
            const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
            retryTimeout = setTimeout(connect, delay);
          }
        }
      }) as EventListener);

      es.onerror = () => {
        es?.close();
        if (stopped) return;

        // Check the run's actual status before retrying.  The EventSource
        // API doesn't distinguish network errors from server-initiated
        // closes, so we ask the backend whether the run is still active.
        fetch(`/api/runs/${runId}`)
          .then((res) => (res.ok ? res.json() : Promise.reject()))
          .then((run: { status: string; exit_code: number | null }) => {
            const TERMINAL = ['success', 'failed', 'cancelled', 'lost'];
            if (TERMINAL.includes(run.status)) {
              // Run is done — stop retrying and notify the consumer
              stopped = true;
              handlersRef.current.onDone?.(
                JSON.stringify({ status: run.status, exit_code: run.exit_code })
              );
            } else {
              // Still running — genuine connection issue, retry with backoff
              scheduleRetry();
            }
          })
          .catch(() => {
            // Status check itself failed (network down) — retry with backoff
            scheduleRetry();
          });
      };

      function scheduleRetry() {
        retries++;
        if (retries > MAX_RETRIES) {
          handlersRef.current.onStreamError?.();
          return;
        }
        const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
        retryTimeout = setTimeout(connect, delay);
      }
    }

    connect();

    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, [runId]);
}
