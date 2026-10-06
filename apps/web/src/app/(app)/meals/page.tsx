import type { Metadata } from 'next';
import { ModuleShell } from '@/components/ModuleShell';
import { plannedSectionsFor } from '@/lib/navigation';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Browse meals' };

/**
 * The customer landing surface, open to every buyer role.
 *
 * Meal browsing, the date/checkpoint/slot pickers and the cart arrive with the
 * catalog module.
 */
export default async function MealsPage() {
  const user = await requireUser('/meals');
  const firstName = user.fullName.split(' ')[0] ?? user.fullName;

  return (
    <ModuleShell
      title={`Welcome, ${firstName}`}
      subtitle="Pick a meal, a date, a checkpoint and a delivery slot."
      moduleName="catalog module"
      sections={plannedSectionsFor(user.role)}
    />
  );
}
