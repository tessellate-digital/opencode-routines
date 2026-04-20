import { describe, it, expect } from 'vitest';
import type { Segment } from '../stores/runStore';

// ── parseSegments (mirrors RunDetail.tsx) ────────────────────────────────────

function parseSegments(events: Array<{ type: string; data: string }>): Segment[] {
  const segments: Segment[] = [];
  for (const evt of events) {
    if (evt.type === 'text') {
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') {
        last.content += evt.data;
      } else {
        segments.push({ kind: 'text', content: evt.data });
      }
    } else if (evt.type === 'tool') {
      const firstNewline = evt.data.indexOf('\n');
      const header = firstNewline === -1 ? evt.data : evt.data.slice(0, firstNewline);
      const args = firstNewline === -1 ? '' : evt.data.slice(firstNewline + 1).trim();
      const name = header
        .replace(/^\[tool:\s*/, '')
        .replace(/\]$/, '')
        .trim();
      segments.push({ kind: 'tool', name, args, result: '', open: false });
    } else if (evt.type === 'tool_result') {
      const last = [...segments].reverse().find((s) => s.kind === 'tool');
      if (last && last.kind === 'tool') {
        last.result = evt.data.replace(/^\[result\]\n?/, '').trim();
      }
    } else if (evt.type === 'error') {
      segments.push({ kind: 'error', content: evt.data });
    } else if (evt.type === 'status' && evt.data.startsWith('--- step') && segments.length > 0) {
      segments.push({ kind: 'step', label: '' });
    }
  }
  return segments;
}

// ── extractTodos (mirrors RunDetail.tsx) ─────────────────────────────────────

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

function extractTodos(segments: Segment[]): TodoItem[] {
  let latest: TodoItem[] = [];
  for (const seg of segments) {
    if (seg.kind !== 'tool' || seg.name !== 'todowrite') continue;
    try {
      const parsed = JSON.parse(seg.args);
      const items = Array.isArray(parsed.todos)
        ? parsed.todos
        : Array.isArray(parsed)
          ? parsed
          : [];
      latest = items.map((t: { content: string; status: string; priority?: string }) => ({
        content: t.content,
        status: t.status as TodoItem['status'],
        priority: t.priority as TodoItem['priority'],
      }));
    } catch {
      if (seg.result) {
        try {
          const items = JSON.parse(seg.result);
          if (Array.isArray(items)) {
            latest = items.map((t: { content: string; status: string; priority?: string }) => ({
              content: t.content,
              status: t.status as TodoItem['status'],
              priority: t.priority as TodoItem['priority'],
            }));
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return latest;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseSegments', () => {
  it('returns empty array for empty input', () => {
    expect(parseSegments([])).toEqual([]);
  });

  it('parses text events and merges consecutive ones', () => {
    const events = [
      { type: 'text', data: 'Hello ' },
      { type: 'text', data: 'world' },
    ];
    const result = parseSegments(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'text', content: 'Hello world' });
  });

  it('does not merge text after a tool', () => {
    const events = [
      { type: 'text', data: 'before' },
      { type: 'tool', data: '[tool: read]\nfile.txt' },
      { type: 'text', data: 'after' },
    ];
    const result = parseSegments(events);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: 'text', content: 'before' });
    expect(result[2]).toEqual({ kind: 'text', content: 'after' });
  });

  it('parses tool events with name and args', () => {
    const events = [{ type: 'tool', data: '[tool: bash]\nls -la' }];
    const result = parseSegments(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: 'tool',
      name: 'bash',
      args: 'ls -la',
      result: '',
      open: false,
    });
  });

  it('parses tool with no args', () => {
    const events = [{ type: 'tool', data: '[tool: glob]' }];
    const result = parseSegments(events);
    expect(result[0]).toMatchObject({ kind: 'tool', name: 'glob', args: '' });
  });

  it('attaches tool_result to the most recent tool', () => {
    const events = [
      { type: 'tool', data: '[tool: read]\nfile.txt' },
      { type: 'tool_result', data: '[result]\nfile contents here' },
    ];
    const result = parseSegments(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'tool',
      name: 'read',
      result: 'file contents here',
    });
  });

  it('parses error events', () => {
    const events = [{ type: 'error', data: 'something broke' }];
    const result = parseSegments(events);
    expect(result).toEqual([{ kind: 'error', content: 'something broke' }]);
  });

  it('parses step events only when segments exist', () => {
    const noSegments = parseSegments([{ type: 'status', data: '--- step ---' }]);
    expect(noSegments).toHaveLength(0);

    const withSegments = parseSegments([
      { type: 'text', data: 'hello' },
      { type: 'status', data: '--- step ---' },
    ]);
    expect(withSegments).toHaveLength(2);
    expect(withSegments[1]).toEqual({ kind: 'step', label: '' });
  });

  it('ignores non-step status events', () => {
    const result = parseSegments([
      { type: 'text', data: 'x' },
      { type: 'status', data: 'something else' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('handles a realistic sequence', () => {
    const events = [
      { type: 'text', data: 'Starting analysis...\n' },
      { type: 'tool', data: '[tool: read]\n/path/file.ts' },
      { type: 'tool_result', data: '[result]\nconst x = 1;' },
      { type: 'status', data: '--- step ---\n' },
      { type: 'text', data: 'Found the issue.' },
      { type: 'tool', data: '[tool: edit]\n/path/file.ts' },
      { type: 'tool_result', data: '[result]\nFile updated' },
      { type: 'text', data: ' Done.' },
      { type: 'error', data: 'lint warning' },
    ];
    const result = parseSegments(events);
    expect(result).toHaveLength(7);
    expect(result.map((s) => s.kind)).toEqual([
      'text',
      'tool',
      'step',
      'text',
      'tool',
      'text',
      'error',
    ]);
  });
});

describe('extractTodos', () => {
  it('returns empty array when no todowrite segments', () => {
    const segments: Segment[] = [
      { kind: 'text', content: 'hello' },
      { kind: 'tool', name: 'read', args: 'file.txt', result: 'content', open: false },
    ];
    expect(extractTodos(segments)).toEqual([]);
  });

  it('extracts todos from todowrite tool args', () => {
    const segments: Segment[] = [
      {
        kind: 'tool',
        name: 'todowrite',
        args: JSON.stringify({
          todos: [
            { content: 'Task A', status: 'completed', priority: 'high' },
            { content: 'Task B', status: 'in_progress', priority: 'medium' },
            { content: 'Task C', status: 'pending', priority: 'low' },
          ],
        }),
        result: '',
        open: false,
      },
    ];
    const todos = extractTodos(segments);
    expect(todos).toHaveLength(3);
    expect(todos[0]).toEqual({ content: 'Task A', status: 'completed', priority: 'high' });
    expect(todos[1]).toEqual({ content: 'Task B', status: 'in_progress', priority: 'medium' });
    expect(todos[2]).toEqual({ content: 'Task C', status: 'pending', priority: 'low' });
  });

  it('uses the LATEST todowrite call (replaces previous)', () => {
    const segments: Segment[] = [
      {
        kind: 'tool',
        name: 'todowrite',
        args: JSON.stringify({
          todos: [{ content: 'Old task', status: 'pending' }],
        }),
        result: '',
        open: false,
      },
      { kind: 'text', content: 'some text' },
      {
        kind: 'tool',
        name: 'todowrite',
        args: JSON.stringify({
          todos: [
            { content: 'New task 1', status: 'completed' },
            { content: 'New task 2', status: 'in_progress' },
          ],
        }),
        result: '',
        open: false,
      },
    ];
    const todos = extractTodos(segments);
    expect(todos).toHaveLength(2);
    expect(todos[0].content).toBe('New task 1');
    expect(todos[1].content).toBe('New task 2');
  });

  it('falls back to parsing result when args are not valid JSON', () => {
    const segments: Segment[] = [
      {
        kind: 'tool',
        name: 'todowrite',
        args: 'not json',
        result: JSON.stringify([{ content: 'From result', status: 'pending', priority: 'high' }]),
        open: false,
      },
    ];
    const todos = extractTodos(segments);
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe('From result');
  });

  it('ignores non-todowrite tools', () => {
    const segments: Segment[] = [
      {
        kind: 'tool',
        name: 'read',
        args: JSON.stringify({ todos: [{ content: 'Not a todo', status: 'pending' }] }),
        result: '',
        open: false,
      },
    ];
    expect(extractTodos(segments)).toEqual([]);
  });

  it('handles empty todos array', () => {
    const segments: Segment[] = [
      {
        kind: 'tool',
        name: 'todowrite',
        args: JSON.stringify({ todos: [] }),
        result: '',
        open: false,
      },
    ];
    expect(extractTodos(segments)).toEqual([]);
  });
});
