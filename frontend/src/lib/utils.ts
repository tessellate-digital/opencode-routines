export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const now = new Date();
  const s = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(start: string | null, end: string | null): string {
  if (!start) return '-';
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const sec = Math.floor((e.getTime() - s.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export const statusColors: Record<string, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-500',
  success: 'text-green-500',
  failed: 'text-red-500',
  cancelled: 'text-yellow-500',
};
