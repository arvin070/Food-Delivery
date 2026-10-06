import 'server-only';

import { apiServer } from './api.server';
import type { FormReferenceData, RefOption } from './reference';

interface InstitutionRow { id: string; name: string }
interface CheckpointRow { id: string; name: string }
interface TimeSlotRow { id: string; label: string }

/** One parallel fetch for everything the profile and child forms need. */
export async function loadFormReferenceData(): Promise<FormReferenceData> {
  const [institutions, checkpoints, timeSlots, cities] = await Promise.all([
    apiServer.get<{ institutions: InstitutionRow[] }>('/reference/institutions'),
    apiServer.get<{ checkpoints: CheckpointRow[] }>('/reference/checkpoints'),
    apiServer.get<{ timeSlots: TimeSlotRow[] }>('/reference/time-slots'),
    apiServer.get<{ cities: RefOption[] }>('/reference/cities'),
  ]);

  return {
    institutions: institutions.institutions.map((i) => ({ id: i.id, name: i.name })),
    checkpoints: checkpoints.checkpoints.map((c) => ({ id: c.id, name: c.name })),
    timeSlots: timeSlots.timeSlots.map((t) => ({ id: t.id, name: t.label })),
    cities: cities.cities.map((c) => ({ id: c.id, name: c.name })),
  };
}
