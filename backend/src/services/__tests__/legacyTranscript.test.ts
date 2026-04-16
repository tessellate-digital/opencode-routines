/**
 * Unit tests for legacyTranscript.ts helper.
 */

import { describe, it, expect } from 'vitest';
import { buildLegacyTranscript } from '../legacyTranscript';

const makeRun = (prompt: string, stdout: string) => ({
  prompt,
  stdout,
});

describe('buildLegacyTranscript', () => {
  it('returns empty string for an empty chain', () => {
    expect(buildLegacyTranscript([])).toBe('');
  });

  it('produces user/assistant block for a single run with no stdout', () => {
    const result = buildLegacyTranscript([makeRun('hello', '')]);
    expect(result).toContain('User: hello');
    expect(result).not.toContain('Assistant:');
  });

  it('extracts text events from JSONL stdout', () => {
    const stdout = [
      JSON.stringify({ type: 'text', data: 'Hello world' }),
      JSON.stringify({ type: 'tool_use', data: 'some tool call' }),
      JSON.stringify({ type: 'text', data: ' continued' }),
    ].join('\n');

    const result = buildLegacyTranscript([makeRun('my question', stdout)]);
    expect(result).toContain('User: my question');
    expect(result).toContain('Assistant: Hello world continued');
    // Should NOT include tool_use data
    expect(result).not.toContain('some tool call');
  });

  it('ignores non-JSON lines in stdout (legacy plain-text format)', () => {
    const stdout = 'plain line\nanother plain line';
    // Should not throw; assistant text might be empty or omitted
    const result = buildLegacyTranscript([makeRun('prompt', stdout)]);
    expect(result).toContain('User: prompt');
  });

  it('handles multi-turn chain with multiple runs', () => {
    const run1stdout = JSON.stringify({ type: 'text', data: 'First answer' });
    const run2stdout = JSON.stringify({ type: 'text', data: 'Second answer' });

    const result = buildLegacyTranscript([
      makeRun('first question', run1stdout),
      makeRun('second question', run2stdout),
    ]);

    expect(result).toContain('User: first question');
    expect(result).toContain('Assistant: First answer');
    expect(result).toContain('User: second question');
    expect(result).toContain('Assistant: Second answer');
  });

  it('skips assistant section when no text events in stdout', () => {
    const stdout = JSON.stringify({ type: 'tool_use', data: 'tool stuff' });
    const result = buildLegacyTranscript([makeRun('question', stdout)]);
    expect(result).toContain('User: question');
    expect(result).not.toContain('Assistant:');
  });
});
