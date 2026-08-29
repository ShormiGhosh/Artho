export function formatBdt(bdt: string | number): string {
  const n = typeof bdt === 'string' ? Number(bdt) : bdt;
  return `৳${n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString();
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  PROCESSING: 'bg-amber-100 text-amber-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-rose-100 text-rose-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-200 text-slate-600',
  EXPIRED: 'bg-slate-200 text-slate-600',
  SKIPPED: 'bg-slate-200 text-slate-600',
  CLOSED: 'bg-slate-200 text-slate-600',
  REMOVED: 'bg-slate-200 text-slate-600',
};

export function statusClass(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600';
}

/** Validates a user amount string: positive, at most 2 decimals. */
export function validAmount(input: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(input.trim()) && Number(input) > 0;
}
