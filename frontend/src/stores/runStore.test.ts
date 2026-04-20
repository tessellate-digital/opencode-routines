import { describe, it, expect, beforeEach } from 'vitest';
import { useRunStore } from './runStore';
import type { Run } from '../lib/types';

const mockRun = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-1',
  routine_id: 'routine-1',
  routine_name: 'Test Routine',
  trigger_id: null,
  trigger_type: 'manual',
  prompt: 'Test prompt',
  parent_run_id: null,
  status: 'success',
  started_at: '2026-01-01T00:00:00Z',
  finished_at: '2026-01-01T00:01:00Z',
  exit_code: 0,
  stdout: [],
  stderr: '',
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('runStore', () => {
  beforeEach(() => {
    useRunStore.getState().reset();
  });

  describe('setThread', () => {
    it('sets the thread array', () => {
      const runs = [mockRun({ id: '1' })];
      useRunStore.getState().setThread(runs);
      expect(useRunStore.getState().thread).toEqual(runs);
    });
  });

  describe('setStreaming', () => {
    it('sets streaming state', () => {
      useRunStore.getState().setStreaming(true);
      expect(useRunStore.getState().isStreaming).toBe(true);

      useRunStore.getState().setStreaming(false);
      expect(useRunStore.getState().isStreaming).toBe(false);
    });
  });

  describe('appendText', () => {
    it('creates a new text segment when empty', () => {
      useRunStore.getState().appendText('Hello');
      const segments = useRunStore.getState().liveSegments;
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ kind: 'text', content: 'Hello' });
    });

    it('appends to existing text segment', () => {
      useRunStore.getState().appendText('Hello');
      useRunStore.getState().appendText(' World');
      const segments = useRunStore.getState().liveSegments;
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ kind: 'text', content: 'Hello World' });
    });

    it('creates new segment after non-text segment', () => {
      useRunStore.getState().appendTool('read', 'file.txt');
      useRunStore.getState().appendText('Result');
      const segments = useRunStore.getState().liveSegments;
      expect(segments).toHaveLength(2);
      expect(segments[1]).toEqual({ kind: 'text', content: 'Result' });
    });
  });

  describe('appendTool', () => {
    it('adds a tool segment', () => {
      useRunStore.getState().appendTool('Read', 'path/to/file');
      const segments = useRunStore.getState().liveSegments;
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({
        kind: 'tool',
        name: 'Read',
        args: 'path/to/file',
        result: '',
        open: false,
      });
    });
  });

  describe('appendToolResult', () => {
    it('updates the most recent tool segment', () => {
      useRunStore.getState().appendTool('Read', 'file.txt');
      useRunStore.getState().appendToolResult('file contents');
      const segments = useRunStore.getState().liveSegments;
      expect(segments[0]).toMatchObject({
        kind: 'tool',
        result: 'file contents',
      });
    });

    it('updates correct tool when multiple exist', () => {
      useRunStore.getState().appendTool('Read', 'file1.txt');
      useRunStore.getState().appendToolResult('contents1');
      useRunStore.getState().appendTool('Read', 'file2.txt');
      useRunStore.getState().appendToolResult('contents2');

      const segments = useRunStore.getState().liveSegments;
      expect(segments[0]).toMatchObject({ result: 'contents1' });
      expect(segments[1]).toMatchObject({ result: 'contents2' });
    });
  });

  describe('appendError', () => {
    it('adds an error segment', () => {
      useRunStore.getState().appendError('Something went wrong');
      const segments = useRunStore.getState().liveSegments;
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ kind: 'error', content: 'Something went wrong' });
    });
  });

  describe('appendStep', () => {
    it('does nothing when segments empty', () => {
      useRunStore.getState().appendStep();
      expect(useRunStore.getState().liveSegments).toHaveLength(0);
    });

    it('adds step divider when segments exist', () => {
      useRunStore.getState().appendText('Some text');
      useRunStore.getState().appendStep();
      const segments = useRunStore.getState().liveSegments;
      expect(segments).toHaveLength(2);
      expect(segments[1]).toEqual({ kind: 'step', label: '' });
    });
  });

  describe('updateRunStatus', () => {
    it('updates status of specified run', () => {
      const runs = [
        mockRun({ id: '1', status: 'running' }),
        mockRun({ id: '2', status: 'running' }),
      ];
      useRunStore.getState().setThread(runs);

      useRunStore.getState().updateRunStatus('1', 'success', 0, '2026-01-01T00:00:00Z');

      const thread = useRunStore.getState().thread;
      expect(thread[0].status).toBe('success');
      expect(thread[0].exit_code).toBe(0);
      expect(thread[1].status).toBe('running');
    });
  });

  describe('addReplyRun', () => {
    it('adds a new run to the thread', () => {
      const parentRun = mockRun({ id: 'parent-1', status: 'success' });
      useRunStore.getState().setThread([parentRun]);

      useRunStore.getState().addReplyRun('new-1', 'Hello', 'Test Routine', 'routine-1');

      const thread = useRunStore.getState().thread;
      expect(thread).toHaveLength(2);
      expect(thread[1]).toMatchObject({
        id: 'new-1',
        prompt: 'Hello',
        routine_name: 'Test Routine',
        routine_id: 'routine-1',
        parent_run_id: 'parent-1',
        status: 'running',
        trigger_type: 'reply',
      });
    });

    it('sets streaming to true and clears live segments', () => {
      useRunStore.getState().appendText('old content');
      useRunStore.getState().setThread([mockRun({ id: '1' })]);

      useRunStore.getState().addReplyRun('2', 'prompt', 'name', 'rid');

      expect(useRunStore.getState().isStreaming).toBe(true);
      expect(useRunStore.getState().liveSegments).toHaveLength(0);
    });
  });

  describe('toggleTool', () => {
    it('toggles tool in toggledTools set', () => {
      useRunStore.getState().toggleTool('run-1', 0);
      expect(useRunStore.getState().toggledTools['run-1']?.has(0)).toBe(true);

      useRunStore.getState().toggleTool('run-1', 0);
      expect(useRunStore.getState().toggledTools['run-1']?.has(0)).toBe(false);
    });

    it('handles multiple tools per run', () => {
      useRunStore.getState().toggleTool('run-1', 0);
      useRunStore.getState().toggleTool('run-1', 2);

      const set = useRunStore.getState().toggledTools['run-1'];
      expect(set?.has(0)).toBe(true);
      expect(set?.has(1)).toBe(false);
      expect(set?.has(2)).toBe(true);
    });
  });

  describe('toggleLiveTool', () => {
    it('toggles open state of tool segment', () => {
      useRunStore.getState().appendTool('Read', 'file.txt');

      useRunStore.getState().toggleLiveTool(0);
      expect(useRunStore.getState().liveSegments[0]).toMatchObject({ open: true });

      useRunStore.getState().toggleLiveTool(0);
      expect(useRunStore.getState().liveSegments[0]).toMatchObject({ open: false });
    });

    it('does nothing for non-tool segments', () => {
      useRunStore.getState().appendText('text');
      useRunStore.getState().toggleLiveTool(0);
      expect(useRunStore.getState().liveSegments[0]).toEqual({ kind: 'text', content: 'text' });
    });
  });

  describe('clearLiveSegments', () => {
    it('clears all live segments', () => {
      useRunStore.getState().appendText('text');
      useRunStore.getState().appendTool('tool', 'args');

      useRunStore.getState().clearLiveSegments();
      expect(useRunStore.getState().liveSegments).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useRunStore.getState().setThread([mockRun({ id: '1' })]);
      useRunStore.getState().appendText('text');
      useRunStore.getState().setStreaming(true);
      useRunStore.getState().toggleTool('run-1', 0);

      useRunStore.getState().reset();

      const state = useRunStore.getState();
      expect(state.thread).toHaveLength(0);
      expect(state.liveSegments).toHaveLength(0);
      expect(state.isStreaming).toBe(false);
      expect(Object.keys(state.toggledTools)).toHaveLength(0);
    });
  });
});
