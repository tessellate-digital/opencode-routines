/**
 * CronPicker – a friendly schedule picker that generates cron expressions.
 *
 * Modes:
 *   Hourly    → "0 * * * *"   (no time input needed)
 *   Daily     → "MM HH * * *"
 *   Weekdays  → "MM HH * * 1-5"
 *   Weekly    → "MM HH * * 0"  (Sunday)
 *   Custom    → raw cron expression text input
 *
 * Props:
 *   value    – current cron expression string
 *   onChange – called with updated expression whenever user changes anything
 */

import { useState, useEffect, useRef } from 'react';
import classNames from 'classnames';

type Mode = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

/**
 * Normalize a cron expression that may be written without spaces.
 * e.g., "*****" → "* * * * *", "0****" → "0 * * * *"
 */
function normalizeCron(expr: string): string {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) return trimmed;

  // Match cron fields: *, */N, N, N-M, N,M,...
  const fieldPattern = /(\*(?:\/\d+)?|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)/g;
  const matches = trimmed.match(fieldPattern);
  if (matches && matches.length === 5) {
    return matches.join(' ');
  }

  return trimmed;
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'custom', label: 'Custom' },
];

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

function toTime(expr: string): string {
  const normalized = normalizeCron(expr);
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return '09:00';
  const [min, hour] = parts;
  if (min === '*' || hour === '*') return '09:00';
  const h = parseInt(hour, 10);
  const m = parseInt(min, 10);
  if (isNaN(h) || isNaN(m)) return '09:00';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildExpression(mode: Mode, time: string, custom: string): string {
  if (mode === 'custom') return custom;
  if (mode === 'hourly') return '0 * * * *';
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr ?? '9', 10);
  const m = parseInt(mStr ?? '0', 10);
  const hh = isNaN(h) ? 9 : h;
  const mm = isNaN(m) ? 0 : m;
  if (mode === 'daily') return `${mm} ${hh} * * *`;
  if (mode === 'weekdays') return `${mm} ${hh} * * 1-5`;
  if (mode === 'weekly') return `${mm} ${hh} * * 0`;
  return '0 * * * *';
}

function humanLabel(mode: Mode, time: string): string {
  if (mode === 'hourly') return 'Runs every hour';
  if (mode === 'daily') return `Runs daily at ${time}`;
  if (mode === 'weekdays') return `Runs weekdays (Mon–Fri) at ${time}`;
  if (mode === 'weekly') return `Runs every Sunday at ${time}`;
  return '';
}

// ---------------------------------------------------------------------------
// Plain-English description for a raw cron expression (custom mode)
// Covers the most common patterns; falls back to empty string for unknown ones.
// ---------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeCustomCron(expr: string): string {
  const normalized = normalizeCron(expr);
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return '';
  const [min, hour, dom, month, dow] = parts;

  // Helpers
  const isAll = (f: string) => f === '*';
  const isNum = (f: string) => /^\d+$/.test(f);
  const isStep = (f: string) => /^\*\/\d+$/.test(f);

  // Time description
  function timeDesc(): string {
    if (isAll(min) && isAll(hour)) return 'every minute';
    if (isStep(min) && isAll(hour)) {
      const n = parseInt(min.split('/')[1], 10);
      return `every ${n} minute${n !== 1 ? 's' : ''}`;
    }
    if (isAll(min) && isStep(hour)) {
      const n = parseInt(hour.split('/')[1], 10);
      return `every ${n} hour${n !== 1 ? 's' : ''}`;
    }
    if (isAll(min) && isNum(hour)) {
      return `every minute during hour ${hour}`;
    }
    if (isNum(min) && isNum(hour)) {
      const h = parseInt(hour, 10);
      const m = parseInt(min, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const mm = String(m).padStart(2, '0');
      return `at ${h12}:${mm} ${ampm}`;
    }
    if (isNum(min) && isAll(hour)) {
      return `at minute ${min} of every hour`;
    }
    return '';
  }

  // Day-of-week description
  function dowDesc(): string {
    if (isAll(dow)) return '';
    if (isNum(dow)) {
      const d = parseInt(dow, 10);
      return d >= 0 && d <= 6 ? `on ${DAYS[d]}s` : '';
    }
    if (dow === '1-5') return 'on weekdays (Mon–Fri)';
    if (dow === '0,6' || dow === '6,0') return 'on weekends';
    return `on days ${dow}`;
  }

  // Day-of-month description
  function domDesc(): string {
    if (isAll(dom)) return '';
    if (isNum(dom)) {
      const d = parseInt(dom, 10);
      const suffix =
        d === 1 || d === 21 || d === 31
          ? 'st'
          : d === 2 || d === 22
            ? 'nd'
            : d === 3 || d === 23
              ? 'rd'
              : 'th';
      return `on the ${d}${suffix}`;
    }
    return `on day ${dom}`;
  }

  // Month description
  function monthDesc(): string {
    if (isAll(month)) return '';
    if (isNum(month)) {
      const m = parseInt(month, 10);
      return m >= 1 && m <= 12 ? `in ${MONTHS[m - 1]}` : '';
    }
    return `in month ${month}`;
  }

  const time = timeDesc();
  if (!time) return '';

  const parts2 = [time, dowDesc(), domDesc(), monthDesc()].filter(Boolean);
  return parts2.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------

interface CronPickerProps {
  value: string;
  onChange: (expression: string) => void;
}

export function CronPicker({ value, onChange }: CronPickerProps) {
  const [mode, setMode] = useState<Mode>(() => toMode(value));
  const [time, setTime] = useState<string>(() => toTime(value));
  const [custom, setCustom] = useState<string>(() => (mode === 'custom' ? value : ''));

  // Track whether the user has explicitly selected a mode in this session.
  // When true we suppress external value-driven mode syncing so that:
  //   1. Choosing "Custom" doesn't get immediately overwritten by the useEffect.
  //   2. Typing in the custom field doesn't cause a tab switch on every keystroke.
  const userSelectedRef = useRef(false);

  // Sync inward only when the parent resets value from outside (e.g. edit-mode
  // pre-population).  Once the user has interacted we stop following the parent.
  useEffect(() => {
    if (userSelectedRef.current) return;
    const newMode = toMode(value);
    setMode(newMode);
    setTime(toTime(value));
    if (newMode === 'custom') setCustom(value);
  }, [value]);

  function handleModeChange(m: Mode) {
    userSelectedRef.current = true;
    setMode(m);
    // When switching to custom, seed the text field with the current expression
    // if it's empty so the user has a starting point.
    const currentExpr = buildExpression(mode, time, custom);
    if (m === 'custom' && !custom) {
      setCustom(currentExpr);
    }
    const expr = buildExpression(m, time, m === 'custom' ? custom || currentExpr : custom);
    onChange(expr);
  }

  function handleTimeChange(t: string) {
    userSelectedRef.current = true;
    setTime(t);
    const expr = buildExpression(mode, t, custom);
    onChange(expr);
  }

  function handleCustomChange(expr: string) {
    userSelectedRef.current = true;
    setCustom(expr);
    onChange(normalizeCron(expr));
  }

  const presetLabel = humanLabel(mode, time);
  const customDesc = mode === 'custom' ? describeCustomCron(custom) : '';

  return (
    <div className="grid gap-3">
      <div className="pills">
        {MODES.map(({ id, label: l }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleModeChange(id)}
            className={classNames('pill', { active: mode === id })}
          >
            {l}
          </button>
        ))}
      </div>

      {mode !== 'hourly' && mode !== 'custom' && (
        <div className="form-row mb-0">
          <label>Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
            className="input w-[112px]"
          />
        </div>
      )}

      {mode === 'custom' && (
        <div className="form-row mb-0">
          <label>Cron expression</label>
          <input
            type="text"
            value={custom}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="e.g. 0 9 * * 1-5"
            className="input max-w-[320px]"
          />
        </div>
      )}

      {presetLabel && <p className="hint">{presetLabel}</p>}
      {mode === 'custom' && customDesc && <p className="hint">{customDesc}</p>}
    </div>
  );
}
