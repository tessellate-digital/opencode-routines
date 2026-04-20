import { useState } from 'react';
import classNames from 'classnames';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

interface TodoBoxProps {
  items: TodoItem[];
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return (
      <svg
        viewBox="0 0 16 16"
        width="13"
        height="13"
        fill="none"
        stroke="var(--status-success)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 mt-px"
      >
        <path d="m3 8 4 4 6-8" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return <span className="dot shrink-0 mt-px" style={{ width: 7, height: 7 }} />;
  }
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="var(--fg-dim)"
      strokeWidth="1.5"
      className="shrink-0 mt-px"
    >
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

export function TodoBox({ items }: TodoBoxProps) {
  const [open, setOpen] = useState(() => items.some((i) => i.status === 'in_progress'));

  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === 'completed').length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div className="sticky top-[53px] z-[9] mb-5 border border-[var(--border)] rounded-[12px] overflow-hidden bg-[var(--surface-hi)]/90 backdrop-blur-[16px] shadow-[var(--shadow-sm)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={classNames('shrink-0 text-[color:var(--fg-dim)] transition-transform', {
            'rotate-90': open,
          })}
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
        <span className="text-[13px] font-medium text-[color:var(--fg)]">Tasks</span>
        <div className="flex-1 h-[3px] rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[11px] font-mono text-[color:var(--fg-dim)] shrink-0">
          {done}/{items.length}
        </span>
      </button>

      {open && (
        <ul className="list-none m-0 py-1.5 px-0 border-t border-[var(--border)]">
          {items.map((item, i) => (
            <li
              key={i}
              className={classNames(
                'flex items-start gap-2.5 py-[5px] px-4 text-[12.5px] leading-[1.45]',
                {
                  'text-[color:var(--fg)]': item.status === 'in_progress',
                  'text-[color:var(--fg-muted)]': item.status !== 'in_progress',
                }
              )}
            >
              <StatusIcon status={item.status} />
              <span
                className={classNames({ 'line-through opacity-45': item.status === 'completed' })}
              >
                {item.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
