import { describe, it, expect } from 'vitest';

// Mirror the toMode logic from CronPicker.tsx for unit testing.
// The component doesn't export it, so we replicate it here.

function normalizeCron(expr: string): string {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) return trimmed;
  const fieldPattern = /(\*(?:\/\d+)?|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)/g;
  const matches = trimmed.match(fieldPattern);
  if (matches && matches.length === 5) return matches.join(' ');
  return trimmed;
}

type Mode = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

function toMode(expr: string): Mode {
  if (!expr || expr === '0 * * * *') return 'hourly';
  const normalized = normalizeCron(expr);
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return 'custom';
  const [min, hour, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') return 'custom';
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return 'custom';
  if (dow === '1-5') return 'weekdays';
  if (dow === '0') return 'weekly';
  if (dow === '*') return 'daily';
  return 'custom';
}

describe('toMode', () => {
  describe('preset modes', () => {
    it('returns hourly for empty string', () => {
      expect(toMode('')).toBe('hourly');
    });

    it('returns hourly for "0 * * * *"', () => {
      expect(toMode('0 * * * *')).toBe('hourly');
    });

    it('returns daily for "0 9 * * *"', () => {
      expect(toMode('0 9 * * *')).toBe('daily');
    });

    it('returns daily for "30 14 * * *"', () => {
      expect(toMode('30 14 * * *')).toBe('daily');
    });

    it('returns weekdays for "0 9 * * 1-5"', () => {
      expect(toMode('0 9 * * 1-5')).toBe('weekdays');
    });

    it('returns weekly for "0 9 * * 0"', () => {
      expect(toMode('0 9 * * 0')).toBe('weekly');
    });

    it('returns weekly for "30 14 * * 0"', () => {
      expect(toMode('30 14 * * 0')).toBe('weekly');
    });
  });

  describe('custom expressions (should NOT match presets)', () => {
    it('returns custom for step minutes "*/5 * * * *"', () => {
      expect(toMode('*/5 * * * *')).toBe('custom');
    });

    it('returns custom for step hours "0 */2 * * *"', () => {
      expect(toMode('0 */2 * * *')).toBe('custom');
    });

    it('returns custom for wildcard minute "* 9 * * *"', () => {
      expect(toMode('* 9 * * *')).toBe('custom');
    });

    it('returns custom for wildcard hour "30 * * * *"', () => {
      expect(toMode('30 * * * *')).toBe('custom');
    });

    it('returns custom for specific dom "0 9 15 * *"', () => {
      expect(toMode('0 9 15 * *')).toBe('custom');
    });

    it('returns custom for specific month "0 9 * 6 *"', () => {
      expect(toMode('0 9 * 6 *')).toBe('custom');
    });

    it('returns custom for single dow number "0 9 * * 3"', () => {
      expect(toMode('0 9 * * 3')).toBe('custom');
    });

    it('returns custom for comma dow "0 9 * * 1,3,5"', () => {
      expect(toMode('0 9 * * 1,3,5')).toBe('custom');
    });

    it('returns custom for range minutes "0-30 9 * * *"', () => {
      expect(toMode('0-30 9 * * *')).toBe('custom');
    });

    it('returns custom for malformed input', () => {
      expect(toMode('not a cron')).toBe('custom');
    });
  });

  describe('normalization', () => {
    it('handles extra whitespace', () => {
      expect(toMode('  0  9  *  *  *  ')).toBe('daily');
    });
  });
});
