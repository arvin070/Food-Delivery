import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type CheckpointSummary } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { CheckpointCard } from '@/components/checkpoints/CheckpointCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Checkpoints · Admin' };

interface CheckpointListResponse {
  data: CheckpointSummary[];
  meta: { total: number; page: number; totalPages: number };
}

export default async function AdminCheckpointsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; isActive?: string; page?: string }>;
}) {
  await requireRole([UserRole.SUPER_ADMIN, UserRole.INSTITUTION_ADMIN], '/admin/checkpoints');
  const filters = await searchParams;

  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.isActive) params.set('isActive', filters.isActive);
  if (filters.page) params.set('page', filters.page);
  params.set('pageSize', '30');

  const { data: checkpoints, meta } = await apiServer.getWithMeta<CheckpointSummary[], CheckpointListResponse['meta']>(
    `/checkpoints?${params}`
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Checkpoints</h1>
          <p className="mt-1 text-sm text-slate-500">
            {meta.total} checkpoint{meta.total !== 1 ? 's' : ''} · delivery points customers can
            select at checkout.
          </p>
        </div>
        <Link href="/admin/checkpoints/new">
          <Button>Add checkpoint</Button>
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3">
        <input
          name="q"
          type="search"
          defaultValue={filters.q ?? ''}
          placeholder="Search by name or institution…"
          className="block rounded-md border-0 py-2 px-3 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 sm:w-72"
        />
        <select
          name="type"
          defaultValue={filters.type ?? ''}
          className="rounded-md border-0 py-2 px-3 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
        >
          <option value="">All types</option>
          <option value="SCHOOL_GATE">School</option>
          <option value="COLLEGE_GATE">College</option>
          <option value="OFFICE_RECEPTION">Office</option>
          <option value="BUS_CHECKPOINT">Bus Stop</option>
          <option value="HOSTEL">Hostel</option>
          <option value="APARTMENT">Apartment</option>
          <option value="COMMUNITY_POINT">Community Point</option>
          <option value="CUSTOM">Custom</option>
          <option value="OTHER">Other</option>
        </select>
        <select
          name="isActive"
          defaultValue={filters.isActive ?? ''}
          className="rounded-md border-0 py-2 px-3 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
        >
          <option value="">Active &amp; inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>

      {checkpoints.length === 0 ? (
        <EmptyState
          title="No checkpoints found"
          description="Create a checkpoint to give customers a designated delivery point."
          action={
            <Link href="/admin/checkpoints/new">
              <Button>Add your first checkpoint</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {checkpoints.map((cp) => (
            <CheckpointCard
              key={cp.id}
              checkpoint={cp}
              editHref={`/admin/checkpoints/${cp.id}/edit`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
