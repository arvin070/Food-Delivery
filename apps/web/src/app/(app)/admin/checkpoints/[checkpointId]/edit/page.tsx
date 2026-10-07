import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UserRole, type CheckpointDetail } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { CheckpointForm } from '@/components/checkpoints/CheckpointForm';
import type { RefOption } from '@/lib/reference';

export const metadata: Metadata = { title: 'Edit checkpoint · Admin' };

interface ZoneRow { id: string; name: string; cityId: string }
interface TimeSlotRow { id: string; label: string }

async function loadCheckpointFormRef() {
  const [{ cities }, { institutions }, { zones }, { timeSlots }] = await Promise.all([
    apiServer.get<{ cities: RefOption[] }>('/reference/cities'),
    apiServer.get<{ institutions: RefOption[] }>('/reference/institutions'),
    apiServer.get<{ zones: ZoneRow[] }>('/reference/zones').catch(() => ({ zones: [] as ZoneRow[] })),
    apiServer.get<{ timeSlots: TimeSlotRow[] }>('/reference/time-slots'),
  ]);
  return {
    cities,
    institutions,
    zones: zones.map((z: ZoneRow) => ({ id: z.id, name: z.name })),
    timeSlots: timeSlots.map((t: TimeSlotRow) => ({ id: t.id, name: t.label })),
  };
}

export default async function EditCheckpointPage({
  params,
}: {
  params: Promise<{ checkpointId: string }>;
}) {
  await requireRole([UserRole.SUPER_ADMIN, UserRole.INSTITUTION_ADMIN], '/admin/checkpoints');
  const { checkpointId } = await params;

  const [checkpointResult, reference] = await Promise.all([
    apiServer
      .get<{ checkpoint: CheckpointDetail }>(`/checkpoints/${checkpointId}`)
      .catch(() => null),
    loadCheckpointFormRef(),
  ]);

  if (!checkpointResult) notFound();
  const { checkpoint } = checkpointResult;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Edit checkpoint
        </h1>
        <p className="mt-1 text-sm text-slate-500">{checkpoint.name}</p>
      </div>
      <CheckpointForm checkpoint={checkpoint} reference={reference} />
    </div>
  );
}
