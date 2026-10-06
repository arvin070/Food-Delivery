import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Browse meals' };

/**
 * Placeholder for the catalog module.
 *
 * It renders the real signed-in shell and confirms the session round-trip
 * works; the meal browsing, date and slot pickers land in the catalog module.
 */
export default async function MealsPage() {
  const user = await requireUser('/meals');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome, {user.fullName.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Pick a meal, a date, a checkpoint and a delivery slot.
        </p>
      </div>

      <Alert tone="info" title="Foundation is live">
        Authentication, the database and the API layer are working. Meal browsing arrives with the
        catalog module.
      </Alert>

      <EmptyState
        title="No meals to show yet"
        description="The catalog module will list published meals for the date and checkpoint you choose."
      />
    </div>
  );
}
