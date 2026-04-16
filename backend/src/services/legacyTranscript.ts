/**
 * legacyTranscript.ts
 *
 * Helper to reconstruct a human-readable conversation transcript from a chain
 * of legacy runs (runs where `session_id IS NULL`).  Used by the reply route to
 * seed a fresh SDK session with the prior conversation context so the model
 * isn't flying blind on the first post-migration reply.
 *
 * Each run contributes:
 *   - A "User: <prompt>" line
 *   - An optional "Assistant: <text>" line built from `text`-type JSONL events
 *     stored in `runs.stdout`
 *
 * Non-`text` events (tool_use, status, etc.) are intentionally skipped so the
 * transcript stays clean.
 */

export interface LegacyRunSlice {
  prompt: string;
  stdout: string;
}

/**
 * Extract all `text` event payloads from a JSONL stdout string.
 * Lines that are not valid JSON or are not `type === 'text'` are silently skipped.
 */
function extractTextFromStdout(stdout: string): string {
  if (!stdout) {
    return '';
  }
  return stdout
    .split('\n')
    .flatMap((line) => {
      if (!line) {
        return [];
      }
      try {
        const evt = JSON.parse(line) as { type: string; data: string };
        return evt.type === 'text' ? [evt.data] : [];
      } catch {
        return [];
      }
    })
    .join('');
}

/**
 * Build a plain-text conversation transcript from a chain of legacy run slices.
 * Returns an empty string when the chain is empty.
 *
 * Format:
 * ```
 * User: <prompt>
 * Assistant: <text output>
 *
 * User: <next prompt>
 * Assistant: <text output>
 * ```
 */
export function buildLegacyTranscript(chain: LegacyRunSlice[]): string {
  if (chain.length === 0) {
    return '';
  }

  const turns: string[] = [];

  for (const run of chain) {
    const userLine = `User: ${run.prompt}`;
    const assistantText = extractTextFromStdout(run.stdout);
    if (assistantText) {
      turns.push(`${userLine}\nAssistant: ${assistantText}`);
    } else {
      turns.push(userLine);
    }
  }

  return turns.join('\n\n');
}
