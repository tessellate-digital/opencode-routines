import { useNavigate } from 'react-router-dom';
import type { Run } from '../lib/types';
import { timeAgo, duration } from '../lib/utils';

const statusStyle: Record<string, string> = {
  pending: 'text-[#6e6e73]',
  running: 'text-[#0071e3]',
  success: 'text-[#34c759]',
  failed: 'text-[#ff3b30]',
  cancelled: 'text-[#ff9500]',
  lost: 'text-[#86868b]',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-sm font-medium ${statusStyle[status] ?? 'text-[#6e6e73]'}`}>
      {status}
    </span>
  );
}

export function RunsTable({ runs }: { runs: Run[] }) {
  const navigate = useNavigate();

  if (!runs.length) {
    return <p className="py-6 text-sm text-[#6e6e73]">No runs yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[#d1d1d6]">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-[#d1d1d6] bg-[#f5f5f7] text-left text-xs font-medium text-[#6e6e73]">
            <th className="px-4 py-2.5">Routine</th>
            <th className="px-4 py-2.5">Trigger</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Duration</th>
            <th className="px-4 py-2.5">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f0f0]">
          {runs.map((r) => (
            <tr
              key={r.id}
              tabIndex={0}
              className="cursor-pointer bg-white hover:bg-[#f5f5f7] outline-none focus-visible:bg-[#f5f5f7]"
              onClick={() => navigate(`/runs/${r.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/runs/${r.id}`);
                }
              }}
            >
              <td className="px-4 py-3 font-medium text-[#1d1d1f]">{r.routine_name}</td>
              <td className="px-4 py-3 text-[#6e6e73] capitalize">{r.trigger_type}</td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3 text-[#6e6e73]">{duration(r.started_at, r.finished_at)}</td>
              <td className="px-4 py-3 text-[#6e6e73]">{timeAgo(r.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
