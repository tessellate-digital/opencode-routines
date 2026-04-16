import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { RunsTable } from '../components/RunsTable';
import type { Run } from '../lib/types';

const PAGE_SIZE = 15;

export default function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const results = await api.getRuns({
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      });
      setHasNext(results.length > PAGE_SIZE);
      setRuns(results.slice(0, PAGE_SIZE));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);
  useGlobalSSE(
    useCallback(() => {
      setPage(0);
    }, [])
  );

  if (loading) return <p className="text-sm text-[#6e6e73]">Loading…</p>;
  if (error) return <p className="text-sm text-[#ff3b30]">Error: {error}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#1d1d1f]">Runs</h1>
      <RunsTable runs={runs} />
      <div className="flex items-center justify-between">
        <button
          onClick={() => setPage((p) => p - 1)}
          disabled={page === 0}
          className="btn btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span className="text-sm text-[#6e6e73]">Page {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext}
          className="btn btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
