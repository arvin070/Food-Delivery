import type { Metadata } from 'next';
import type { CustomerProfile } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { loadFormReferenceData } from '@/lib/reference.server';
import { requireUser } from '@/lib/session';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'My profile' };

export default async function ProfilePage() {
  await requireUser('/profile');

  // Fetched in parallel: the form needs both before it can render populated.
  const [{ profile }, reference] = await Promise.all([
    apiServer.get<{ profile: CustomerProfile }>('/profile/me'),
    loadFormReferenceData(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My profile</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your contact details and the preferences we use when you order.
        </p>
      </div>

      <ProfileForm profile={profile} reference={reference} />
    </div>
  );
}
