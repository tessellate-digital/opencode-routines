import { create } from 'zustand';
import type { Run } from '../lib/types';

type TextSegment = { kind: 'text'; content: string };
type ToolSegment = {
  kind: 'tool';
  name: string;
  args: string;
  result: string;
  open: boolean;
};
type ErrorSegment = { kind: 'error'; content: string };
type StepSegment = { kind: 'step'; label: string };

export type Segment = TextSegment | ToolSegment | ErrorSegment | StepSegment;

interface RunStore {
  thread: Run[];
  liveSegments: Segment[];
  isStreaming: boolean;
  toggledTools: Record<string, Set<number>>;

  setThread: (runs: Run[]) => void;
  setStreaming: (streaming: boolean) => void;
  clearLiveSegments: () => void;

  appendText: (text: string) => void;
  appendTool: (name: string, args: string) => void;
  appendToolResult: (result: string) => void;
  appendError: (content: string) => void;
  appendStep: () => void;

  updateRunStatus: (
    runId: string,
    status: Run['status'],
    exitCode: number | null,
    finishedAt: string | null
  ) => void;
  finalizeStream: () => void;

  toggleTool: (runId: string, idx: number) => void;
  toggleLiveTool: (idx: number) => void;

  addReplyRun: (runId: string, prompt: string, routineName: string, routineId: string) => void;

  reset: () => void;
}

export const useRunStore = create<RunStore>((set, get) => ({
  thread: [],
  liveSegments: [],
  isStreaming: false,
  toggledTools: {},

  setThread: (runs) => set({ thread: runs }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  clearLiveSegments: () => set({ liveSegments: [] }),

  appendText: (text) =>
    set((state) => {
      const segments = [...state.liveSegments];
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') {
        segments[segments.length - 1] = { ...last, content: last.content + text };
      } else {
        segments.push({ kind: 'text', content: text });
      }
      return { liveSegments: segments };
    }),

  appendTool: (name, args) =>
    set((state) => ({
      liveSegments: [...state.liveSegments, { kind: 'tool', name, args, result: '', open: false }],
    })),

  appendToolResult: (result) =>
    set((state) => {
      const segments = [...state.liveSegments];
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].kind === 'tool') {
          segments[i] = { ...segments[i], result } as ToolSegment;
          break;
        }
      }
      return { liveSegments: segments };
    }),

  appendError: (content) =>
    set((state) => ({
      liveSegments: [...state.liveSegments, { kind: 'error', content }],
    })),

  appendStep: () =>
    set((state) => {
      if (state.liveSegments.length === 0) return state;
      return { liveSegments: [...state.liveSegments, { kind: 'step', label: '' }] };
    }),

  updateRunStatus: (runId, status, exitCode, finishedAt) =>
    set((state) => ({
      thread: state.thread.map((run) =>
        run.id === runId ? { ...run, status, exit_code: exitCode, finished_at: finishedAt } : run
      ),
    })),

  finalizeStream: () => {
    const { thread, liveSegments } = get();
    if (thread.length === 0) return;

    const lastRun = thread[thread.length - 1];
    const stdout: Array<{ type: string; data: string }> = [];
    for (const seg of liveSegments) {
      if (seg.kind === 'text') stdout.push({ type: 'text', data: seg.content });
      else if (seg.kind === 'tool')
        stdout.push({ type: 'tool', data: `[tool: ${seg.name}]\n${seg.args}` });
      else if (seg.kind === 'error') stdout.push({ type: 'error', data: seg.content });
      else if (seg.kind === 'step') stdout.push({ type: 'status', data: '--- step ---' });
    }

    set({
      thread: thread.map((run) => (run.id === lastRun.id ? { ...run, stdout } : run)),
      liveSegments: [],
      isStreaming: false,
    });
  },

  toggleTool: (runId, idx) =>
    set((state) => {
      const runSet = new Set(state.toggledTools[runId] ?? []);
      if (runSet.has(idx)) runSet.delete(idx);
      else runSet.add(idx);
      return { toggledTools: { ...state.toggledTools, [runId]: runSet } };
    }),

  toggleLiveTool: (idx) =>
    set((state) => {
      const segments = [...state.liveSegments];
      const seg = segments[idx];
      if (seg?.kind === 'tool') {
        segments[idx] = { ...seg, open: !seg.open };
      }
      return { liveSegments: segments };
    }),

  addReplyRun: (runId, prompt, routineName, routineId) => {
    const { thread } = get();
    const parentRun = thread[thread.length - 1];
    const newRun: Run = {
      id: runId,
      routine_id: routineId,
      routine_name: routineName,
      trigger_id: null,
      trigger_type: 'reply',
      prompt,
      parent_run_id: parentRun?.id ?? null,
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      exit_code: null,
      stdout: [],
      stderr: '',
      metadata: {},
      created_at: new Date().toISOString(),
    };
    set({
      thread: [...thread, newRun],
      liveSegments: [],
      isStreaming: true,
    });
  },

  reset: () => set({ thread: [], liveSegments: [], isStreaming: false, toggledTools: {} }),
}));
