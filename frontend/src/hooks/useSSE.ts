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
  },
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!runId) return;

    const es = new EventSource(`/api/runs/${runId}/stream`);

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
      handlersRef.current.onDone?.(me.data);
      es.close();
    }) as EventListener);

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId]);
}
