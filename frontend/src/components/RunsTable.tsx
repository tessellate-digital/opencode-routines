import { useNavigate } from 'react-router-dom';
import type { Run } from '../lib/types';
import { timeAgo, duration } from '../lib/utils';

type StatusConfig = {
  pill: string;
  dot: string;
  pulse?: boolean;
};

const statusConfig: Record<string, StatusConfig> = {
  pending: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  running: { pill: 'bg-accent-soft text-accent', dot: 'bg-accent', pulse: true },
  success: { pill: 'bg-success-soft text-success', dot: 'bg-success' },
  failed: { pill: 'bg-destructive-soft text-destructive', dot: 'bg-destructive' },
  cancelled: { pill: 'bg-warning-soft text-warning', dot: 'bg-warning' },
  lost: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? statusConfig.pending;
  return (
    <span className={`status-pill ${cfg.pill}`}>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse-soft' : ''}`}
      />
      {status}
    </span>
  );
}

export function RunsTable({ runs }: { runs: Run[] }) {
  const navigate = useNavigate();

  if (!runs.length) {
    return <p className="py-6 text-sm text-muted-foreground">No runs yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 shadow-sm backdrop-blur-md">
      <div className="grid grid-cols-[1.8fr_1fr_1fr_1fr_0.8fr] border-b border-border/70 bg-surface/50 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div>Routine</div>
        <div>Trigger</div>
        <div>Status</div>
        <div>Duration</div>
        <div>Started</div>
      </div>
      {runs.map((r, i) => (
        <div
          key={r.id}
          tabIndex={0}
          className={`grid cursor-pointer grid-cols-[1.8fr_1fr_1fr_1fr_0.8fr] items-center px-4 py-3 text-[13px] transition-colors hover:bg-accent/5 focus-visible:bg-accent/5 focus-visible:outline-none ${i > 0 ? 'border-t border-border/70' : ''}`}
          onClick={() => navigate(`/runs/${r.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigate(`/runs/${r.id}`);
            }
          }}
        >
          <div className="font-medium text-foreground">{r.routine_name}</div>
          <div className="font-mono text-[12px] capitalize text-muted-foreground">
            {r.trigger_type}
          </div>
          <div>
            <StatusBadge status={r.status} />
          </div>
          <div className="font-mono text-[12px] text-muted-foreground">
            {duration(r.started_at, r.finished_at)}
          </div>
          <div className="text-[12px] text-muted-foreground">{timeAgo(r.started_at)}</div>
        </div>
      ))}
    </div>
  );
}
