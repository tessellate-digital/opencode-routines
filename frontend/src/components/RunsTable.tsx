import { useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import type { Run } from '../lib/types';
import { timeAgo, duration } from '../lib/utils';

const statusClassMap: Record<string, string> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failed: 'failed',
  cancelled: 'cancelled',
  lost: 'lost',
  warning: 'warning',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = statusClassMap[status] ?? 'pending';
  return (
    <span className={classNames('status', cls)}>
      <span className="dot" />
      <span>{status}</span>
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

export function RunsTable({ runs }: { runs: Run[] }) {
  const navigate = useNavigate();

  if (!runs.length) {
    return (
      <div className="card">
        <div className="p-12 text-center text-[color:var(--fg-muted)]">No runs yet.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <table className="tbl">
        <thead>
          <tr>
            <th>Routine</th>
            <th>Trigger</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Started</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => navigate(`/runs/${r.id}`)}>
              <td>
                <div className="primary-cell">{r.routine_name}</div>
              </td>
              <td>
                <span className="trig">
                  <span>{r.trigger_type}</span>
                </span>
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <span className="mono">{duration(r.started_at, r.finished_at)}</span>
              </td>
              <td>
                <span className="mono">{timeAgo(r.started_at)}</span>
              </td>
              <td className="chev">
                <ChevronIcon />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
