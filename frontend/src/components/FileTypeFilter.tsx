import { useState, useRef, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileFilterValue {
  mode: 'include' | 'exclude' | 'none';
  patterns: string[];
}

interface FileTypeFilterProps {
  value: FileFilterValue;
  onChange: (v: FileFilterValue) => void;
}

// ---------------------------------------------------------------------------
// Preset extensions (flat list, with category labels)
// ---------------------------------------------------------------------------

interface Preset {
  ext: string;
  category: string;
}

const PRESETS: Preset[] = [
  { ext: '.mp4', category: 'Video' },
  { ext: '.mkv', category: 'Video' },
  { ext: '.avi', category: 'Video' },
  { ext: '.mov', category: 'Video' },
  { ext: '.webm', category: 'Video' },
  { ext: '.mp3', category: 'Audio' },
  { ext: '.flac', category: 'Audio' },
  { ext: '.wav', category: 'Audio' },
  { ext: '.aac', category: 'Audio' },
  { ext: '.jpg', category: 'Image' },
  { ext: '.png', category: 'Image' },
  { ext: '.gif', category: 'Image' },
  { ext: '.webp', category: 'Image' },
  { ext: '.svg', category: 'Image' },
  { ext: '.pdf', category: 'Document' },
  { ext: '.docx', category: 'Document' },
  { ext: '.md', category: 'Document' },
  { ext: '.txt', category: 'Document' },
  { ext: '.ts', category: 'Code' },
  { ext: '.js', category: 'Code' },
  { ext: '.py', category: 'Code' },
  { ext: '.go', category: 'Code' },
  { ext: '.rs', category: 'Code' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileTypeFilter({ value, onChange }: FileTypeFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
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
    if (open) inputRef.current?.focus();
  }, [open]);

  const selected = new Set(value.patterns);

  const toggle = (ext: string) => {
    const next = new Set(selected);
    if (next.has(ext)) next.delete(ext);
    else next.add(ext);
    onChange({ ...value, patterns: [...next] });
  };

  const addCustom = () => {
    let ext = query.trim().toLowerCase();
    if (!ext) return;
    if (!ext.startsWith('.')) ext = '.' + ext;
    if (!selected.has(ext)) {
      onChange({ ...value, patterns: [...value.patterns, ext] });
    }
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustom();
    }
  };

  const q = query.toLowerCase();
  const filtered = PRESETS.filter(
    (p) => !q || p.ext.includes(q) || p.category.toLowerCase().includes(q)
  );

  // Group filtered by category to display labels
  let lastCategory = '';

  return (
    <div className="space-y-2">
      {/* Mode toggle — checkboxes so neither needs to be selected */}
      <div className="flex gap-4 text-sm">
        {(['include', 'exclude'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.mode === m}
              onChange={() => onChange({ ...value, mode: value.mode === m ? 'none' : m })}
            />
            {m === 'include' ? 'Only these types' : 'Ignore these types'}
          </label>
        ))}
      </div>

      {/* Selected tags */}
      {value.patterns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.patterns.map((ext) => (
            <span
              key={ext}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                value.mode === 'include'
                  ? 'bg-success-soft text-success'
                  : 'bg-destructive-soft text-destructive'
              }`}
            >
              {ext}
              <button type="button" onClick={() => toggle(ext)} className="ml-0.5 hover:opacity-70">
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown trigger */}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn btn-secondary text-xs"
        >
          {value.patterns.length === 0 ? 'Select file types' : 'Add more'}
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-80 overflow-hidden rounded-xl border border-border/70 bg-surface/95 shadow-lg backdrop-blur-md">
            {/* Search / custom input */}
            <div className="border-b border-border/70 p-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Filter or type custom ext..."
                className="input-field text-[13px] py-1.5"
              />
            </div>

            {/* Custom add hint */}
            {query.trim() &&
              !PRESETS.some((p) => p.ext === (query.startsWith('.') ? query : '.' + query)) && (
                <button
                  type="button"
                  onClick={addCustom}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10"
                >
                  Add "{query.startsWith('.') ? query : '.' + query}"
                </button>
              )}

            {/* Preset list */}
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.map((p) => {
                const showCat = p.category !== lastCategory;
                lastCategory = p.category;
                return (
                  <div key={p.ext}>
                    {showCat && (
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {p.category}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(p.ext)}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-accent/10 ${
                        selected.has(p.ext) ? 'font-medium text-accent' : 'text-foreground'
                      }`}
                    >
                      <span>{p.ext}</span>
                      {selected.has(p.ext) && <span className="text-xs">✓</span>}
                    </button>
                  </div>
                );
              })}
              {filtered.length === 0 && !query.trim() && (
                <p className="px-3 py-2 text-[13px] text-muted-foreground">
                  No file types available
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
