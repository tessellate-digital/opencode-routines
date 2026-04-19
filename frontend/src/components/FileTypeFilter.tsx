import { useState, useRef } from 'react';
import classNames from 'classnames';

export interface FileFilterValue {
  mode: 'include' | 'exclude' | 'none';
  patterns: string[];
}

interface FileTypeFilterProps {
  value: FileFilterValue;
  onChange: (v: FileFilterValue) => void;
}

const CATEGORIES: { name: string; extensions: string[] }[] = [
  { name: 'Code', extensions: ['.ts', '.js', '.py', '.go', '.rs', '.java', '.cpp', '.c'] },
  { name: 'Docs', extensions: ['.md', '.txt', '.pdf', '.docx', '.doc'] },
  { name: 'Images', extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'] },
  { name: 'Video', extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'] },
  { name: 'Audio', extensions: ['.mp3', '.flac', '.wav', '.aac', '.ogg'] },
];

const MODES = [
  { value: 'none' as const, label: 'All files' },
  { value: 'include' as const, label: 'Only these types' },
  { value: 'exclude' as const, label: 'Exclude these types' },
];

export function FileTypeFilter({ value, onChange }: FileTypeFilterProps) {
  const [customInput, setCustomInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = new Set(value.patterns);

  const toggle = (ext: string) => {
    const next = new Set(selected);
    if (next.has(ext)) {
      next.delete(ext);
    } else {
      next.add(ext);
    }
    onChange({ ...value, patterns: [...next] });
  };

  const toggleCategory = (extensions: string[]) => {
    const next = new Set(value.patterns);
    const allPresent = extensions.every((ext) => next.has(ext));
    if (allPresent) {
      extensions.forEach((ext) => next.delete(ext));
    } else {
      extensions.forEach((ext) => next.add(ext));
    }
    onChange({ ...value, patterns: [...next] });
  };

  const addCustom = () => {
    let ext = customInput.trim().toLowerCase();
    if (!ext) {
      return;
    }
    if (!ext.startsWith('.')) {
      ext = '.' + ext;
    }
    if (!selected.has(ext)) {
      onChange({ ...value, patterns: [...value.patterns, ext] });
    }
    setCustomInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustom();
    }
  };

  const active = value.mode !== 'none';

  return (
    <div className="file-type-filter">
      <div className="chip-row">
        {MODES.map((m) => (
          <button
            type="button"
            key={m.value}
            className={classNames('chip', { active: value.mode === m.value })}
            onClick={() => onChange({ ...value, mode: m.value })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {active && (
        <div className="ftf-detail">
          <div className="chip-row">
            {CATEGORIES.map((cat) => {
              const allPresent = cat.extensions.every((ext) => selected.has(ext));
              return (
                <button
                  type="button"
                  key={cat.name}
                  className={classNames('chip', { active: allPresent })}
                  onClick={() => toggleCategory(cat.extensions)}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>

          <div className="ftf-custom">
            <input
              ref={inputRef}
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Custom extension, e.g. .csv"
              className="input"
            />
            <button
              type="button"
              className="btn sm"
              onClick={addCustom}
              disabled={!customInput.trim()}
            >
              Add
            </button>
          </div>

          {value.patterns.length > 0 && (
            <div className="ftf-tags">
              {value.patterns.map((ext) => (
                <span
                  key={ext}
                  className={classNames('ftf-tag', {
                    include: value.mode === 'include',
                    exclude: value.mode === 'exclude',
                  })}
                >
                  {ext}
                  <button type="button" onClick={() => toggle(ext)} className="ftf-tag-remove">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
