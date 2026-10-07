'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CHECKPOINT_TYPE_LABELS, type CheckpointSummary } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

/** One checkpoint in the admin list, with quick-toggle and edit link. */
export function CheckpointCard({
  checkpoint,
  editHref,
}: {
  checkpoint: CheckpointSummary;
  editHref: string;
}) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleStatus() {
    setError(null);
    setToggling(true);
    try {
      await apiClient.patch(`/v1/checkpoints/${checkpoint.id}/status`, {
        isActive: !checkpoint.isActive,
      });
      router.refresh();
    } catch (err) {
      const { formError } = toFormErrors(err);
      setError(formError ?? 'Could not update checkpoint status.');
      setToggling(false);
    }
  }

  const typeLabel = CHECKPOINT_TYPE_LABELS[checkpoint.type] ?? checkpoint.type;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{checkpoint.name}</h3>
            <StatusBadge status={checkpoint.isActive ? 'active' : 'inactive'} />
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {typeLabel}
            {checkpoint.institutionName ? ` · ${checkpoint.institutionName}` : ''}
            {` · ${checkpoint.cityName}`}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link href={editHref}>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>
          <Button
            variant={checkpoint.isActive ? 'ghost' : 'secondary'}
            size="sm"
            loading={toggling}
            onClick={toggleStatus}
          >
            {toggling ? '…' : checkpoint.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </li>
  );
}
