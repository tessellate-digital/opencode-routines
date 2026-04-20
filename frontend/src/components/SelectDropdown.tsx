import { useEffect, useState, useRef } from 'react';
import classNames from 'classnames';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

interface SelectDropdownProps {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  filterable?: boolean;
}

export function SelectDropdown({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  filterable = false,
}: SelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && filterable) inputRef.current?.focus();
  }, [open, filterable]);

  const q = query.toLowerCase();
  const filtered = options.filter((o) => !q || o.label.toLowerCase().includes(q));

  const groups = new Map<string, SelectOption[]>();
  const ungrouped: SelectOption[] = [];
  for (const o of filtered) {
    if (o.group) {
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group)!.push(o);
    } else {
      ungrouped.push(o);
    }
  }

  const selectedLabel = options.find((o) => o.value === value)?.label;

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="truncate">
          {selectedLabel || <span className="text-[color:var(--fg-dim)]">{placeholder}</span>}
        </span>
        <svg
          className={classNames(
            'w-4 h-4 shrink-0 text-[color:var(--fg-dim)] transition-transform duration-[180ms]',
            { 'rotate-180': open }
          )}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.937a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.061z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--surface-2)] border border-[var(--border-hi)] rounded-[var(--r-lg)] shadow-[var(--shadow-lg)] overflow-hidden backdrop-blur-[20px]">
          {filterable && (
            <div className="p-2 border-b border-[var(--border)]">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="input text-[13px]"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {ungrouped.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => handleSelect(o.value)}
                className={classNames(
                  'block w-full text-left py-1.5 px-3 text-[13px] bg-transparent border-0',
                  {
                    'text-[color:var(--accent)] font-medium': o.value === value,
                    'text-[color:var(--fg)] font-normal': o.value !== value && !o.disabled,
                    'text-[color:var(--fg-muted)] cursor-not-allowed': o.disabled,
                    'cursor-pointer': !o.disabled,
                  }
                )}
              >
                {o.label}
              </button>
            ))}
            {ungrouped.length > 0 && groups.size > 0 && <div className="divider my-1" />}
            {[...groups.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([group, items]) => (
                <div key={group}>
                  <div className="py-1 px-3 font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)]">
                    {group}
                  </div>
                  {items.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      disabled={o.disabled}
                      onClick={() => handleSelect(o.value)}
                      className={classNames(
                        'block w-full text-left py-1.5 px-3 text-[13px] bg-transparent border-0',
                        {
                          'text-[color:var(--accent)] font-medium': o.value === value,
                          'text-[color:var(--fg)] font-normal': o.value !== value && !o.disabled,
                          'text-[color:var(--fg-muted)] cursor-not-allowed': o.disabled,
                          'cursor-pointer': !o.disabled,
                        }
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ))}
            {filtered.length === 0 && (
              <p className="py-2 px-3 text-[13px] text-[color:var(--fg-muted)]">
                No matches for "{query}"
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
