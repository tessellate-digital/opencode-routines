import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { RunsTable } from '../components/RunsTable';
import type { Run } from '../lib/types';

export default function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await api.getRuns({ limit: 50 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useGlobalSSE(useCallback(() => { load(); }, [load]));

  if (loading) return <p className="text-sm text-[#6e6e73]">Loading…</p>;
  if (error)   return <p className="text-sm text-[#ff3b30]">Error: {error}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#1d1d1f]">Runs</h1>
      <RunsTable runs={runs} />
    </div>
  );
}
