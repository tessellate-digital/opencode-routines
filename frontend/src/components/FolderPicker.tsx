/**
 * FolderPicker – a modal that lets users browse user-mounted workspace folders
 * and select a directory for the routine to run against.
 *
 * Only directories that are explicitly bind-mounted under /workspaces are
 * browsable. If nothing is mounted, the component shows instructions instead.
 *
 * Props:
 *   value     – currently selected path (empty string = none)
 *   onChange  – called with the chosen absolute path
 *   onClose   – called when the modal should be dismissed
 */

import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { FsEntry } from '../lib/types';

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  onClose: () => void;
}

type Phase =
  | { state: 'loading' }
  | { state: 'no-mounts' }
  | {
      state: 'browsing';
      currentPath: string;
      mountRoot: string;
      parent: string | null;
      entries: FsEntry[];
    }
  | { state: 'error'; message: string };

export function FolderPicker({ value, onChange, onClose }: FolderPickerProps) {
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

  // Load the initial view: start inside the saved path if valid, else show mount list
  useEffect(() => {
    async function init() {
      try {
        const { mounts } = await api.getMounts();
        if (mounts.length === 0) {
          setPhase({ state: 'no-mounts' });
          return;
        }
        // If we have a saved value that lives inside a known mount, open it directly
        const savedMount = value
          ? mounts.find((m) => value === m || value.startsWith(m + '/'))
          : undefined;
        if (savedMount) {
          await browse(value);
        } else {
          // Show all mounts by browsing the workspaces root
          const root = mounts[0].split('/').slice(0, -1).join('/');
          await browse(root);
        }
      } catch (e) {
        setPhase({
          state: 'error',
          message: e instanceof Error ? e.message : 'Failed to load',
        });
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function browse(dir: string) {
    setPhase({ state: 'loading' });
    try {
      const res = await api.browseFs(dir);
      setPhase({
        state: 'browsing',
        currentPath: res.path,
        mountRoot: res.root,
        parent: res.parent,
        entries: res.entries,
      });
    } catch (e) {
      setPhase({
        state: 'error',
        message: e instanceof Error ? e.message : 'Failed to read directory',
      });
    }
  }

  // Build breadcrumb segments relative to the mount root
  function breadcrumbs(currentPath: string, mountRoot: string) {
    const mountName = mountRoot.split('/').filter(Boolean).pop() ?? mountRoot;
    const relPath = currentPath.startsWith(mountRoot)
      ? currentPath.slice(mountRoot.length).replace(/^\//, '')
      : '';
    const segments = relPath ? relPath.split('/').filter(Boolean) : [];
    return { mountName, segments };
  }

  function segmentPath(mountRoot: string, segments: string[], idx: number) {
    return mountRoot + '/' + segments.slice(0, idx + 1).join('/');
  }

  const isBrowsing = phase.state === 'browsing';
  const currentPath = isBrowsing ? phase.currentPath : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border/70 bg-surface/95 shadow-lg backdrop-blur-md flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <span className="text-[13px] font-semibold text-foreground">Select folder</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Breadcrumb — only shown while browsing */}
        {phase.state === 'browsing' &&
          (() => {
            const { mountName, segments } = breadcrumbs(phase.currentPath, phase.mountRoot);
            return (
              <div className="flex items-center gap-0.5 px-4 py-2 text-xs text-muted-foreground flex-wrap border-b border-border/70">
                <button
                  onClick={() => browse(phase.mountRoot)}
                  className={
                    segments.length === 0
                      ? 'font-medium text-foreground'
                      : 'hover:text-accent hover:underline'
                  }
                >
                  {mountName}
                </button>
                {segments.map((seg, idx) => (
                  <span key={idx} className="flex items-center gap-0.5">
                    <span className="text-border-strong">/</span>
                    <button
                      onClick={() => browse(segmentPath(phase.mountRoot, segments, idx))}
                      className={
                        idx === segments.length - 1
                          ? 'font-medium text-foreground'
                          : 'hover:text-accent hover:underline'
                      }
                    >
                      {seg}
                    </button>
                  </span>
                ))}
              </div>
            );
          })()}

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {phase.state === 'loading' && (
            <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
              Loading…
            </div>
          )}

          {phase.state === 'error' && (
            <div className="px-4 py-4 text-[13px] text-destructive">{phase.message}</div>
          )}

          {phase.state === 'no-mounts' && (
            <div className="px-6 py-8 text-center space-y-3">
              <p className="text-[13px] font-medium text-foreground">No folders mounted yet</p>
              <p className="text-xs text-muted-foreground">
                Add a bind-mount to the <span className="font-mono">backend</span> service in{' '}
                <span className="font-mono">docker-compose.yml</span>, then restart:
              </p>
              <pre className="inline-block rounded-lg border border-border/70 bg-muted px-4 py-3 text-left text-xs font-mono text-foreground whitespace-pre">
                {`volumes:
  - /your/local/path:/workspaces/my-project`}
              </pre>
            </div>
          )}

          {phase.state === 'browsing' && (
            <ul className="divide-y divide-border/50">
              {phase.parent !== null && (
                <li>
                  <button
                    onClick={() => browse(phase.parent!)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] text-muted-foreground hover:bg-accent/5"
                  >
                    <span>↑</span>
                    <span className="font-mono">..</span>
                  </button>
                </li>
              )}
              {phase.entries.length === 0 && (
                <li className="px-4 py-3 text-[13px] text-muted-foreground">No subdirectories</li>
              )}
              {phase.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    onClick={() => browse(entry.path)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-accent/5"
                  >
                    <span className="shrink-0">📁</span>
                    <span className="font-mono text-foreground truncate">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/70 px-4 py-3 space-y-2">
          {isBrowsing && (
            <p className="font-mono text-xs text-muted-foreground truncate" title={currentPath}>
              {currentPath}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            {isBrowsing && (
              <button
                onClick={() => {
                  onChange(currentPath);
                  onClose();
                }}
                className="btn btn-primary"
              >
                Select this folder
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
