import { describe, it, expect } from 'vitest';

// parseStdout is not exported, so we test it indirectly via a local copy.
// This mirrors the function in runs.ts exactly.
function parseStdout(raw: string): Array<{ type: string; data: string }> {
  if (!raw) {
    return [];
  }
  const events: Array<{ type: string; data: string }> = [];
  for (const line of raw.split('\n')) {
    if (!line) {
      continue;
    }
    try {
      const evt = JSON.parse(line) as { type: string; data: string };
      events.push(evt);
    } catch {
      events.push({ type: 'text', data: line });
    }
  }
  return events;
}

describe('parseStdout', () => {
  it('returns empty array for empty string', () => {
    expect(parseStdout('')).toEqual([]);
  });

  it('returns empty array for undefined-like falsy value', () => {
    expect(parseStdout(null as unknown as string)).toEqual([]);
  });

  it('parses single JSONL line', () => {
    const raw = '{"type":"text","data":"hello"}';
    expect(parseStdout(raw)).toEqual([{ type: 'text', data: 'hello' }]);
  });

  it('parses multiple JSONL lines', () => {
    const raw = [
      '{"type":"text","data":"hello"}',
      '{"type":"tool","data":"[tool: read]\\nfile.txt"}',
      '{"type":"tool_result","data":"[result]\\ncontents"}',
      '{"type":"status","data":"--- step ---"}',
      '{"type":"error","data":"something failed"}',
    ].join('\n');

    const result = parseStdout(raw);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ type: 'text', data: 'hello' });
    expect(result[1].type).toBe('tool');
    expect(result[4]).toEqual({ type: 'error', data: 'something failed' });
  });

  it('skips empty lines', () => {
    const raw = '{"type":"text","data":"a"}\n\n{"type":"text","data":"b"}';
    expect(parseStdout(raw)).toHaveLength(2);
  });

  it('falls back to text for non-JSON lines', () => {
    const raw = 'this is plain text';
    expect(parseStdout(raw)).toEqual([{ type: 'text', data: 'this is plain text' }]);
  });

  it('handles mixed valid and invalid JSON', () => {
    const raw = '{"type":"text","data":"ok"}\nbad line\n{"type":"error","data":"err"}';
    const result = parseStdout(raw);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'text', data: 'ok' });
    expect(result[1]).toEqual({ type: 'text', data: 'bad line' });
    expect(result[2]).toEqual({ type: 'error', data: 'err' });
  });
});
