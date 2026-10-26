import { RealtimeSync } from '@/components/tracking/RealtimeSync';
import { RiderSharingProvider } from '@/components/tracking/RiderTracking';
import { AppHeader } from '@/components/AppHeader';
import { requireUser } from '@/lib/session';

/** Shell for every signed-in screen. Unauthenticated visitors are redirected. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <AppHeader user={user} />
      <RealtimeSync key={user.id} />
      {user.role === 'DELIVERY_PARTNER' ? <RiderSharingProvider key={user.id}>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      </RiderSharingProvider> : <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>}
    </div>
  );
}
