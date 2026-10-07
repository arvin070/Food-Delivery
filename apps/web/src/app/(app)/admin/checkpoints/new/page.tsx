import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { CheckpointForm } from '@/components/checkpoints/CheckpointForm';
import type { RefOption } from '@/lib/reference';

export const metadata: Metadata = { title: 'New checkpoint · Admin' };

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

export default async function NewCheckpointPage() {
  await requireRole([UserRole.SUPER_ADMIN, UserRole.INSTITUTION_ADMIN], '/admin/checkpoints/new');
  const reference = await loadCheckpointFormRef();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New checkpoint</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a delivery point customers can select at checkout.
        </p>
      </div>
      <CheckpointForm reference={reference} />
    </div>
  );
}
