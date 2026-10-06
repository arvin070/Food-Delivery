'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiClient.post('/v1/auth/logout');
    } catch {
      // Sign-out is best-effort: the cookies are cleared either way, so send
      // the user to the sign-in screen rather than trapping them here.
    }
    router.refresh();
    router.replace('/login');
  }

  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={signOut}>
      Sign out
    </Button>
  );
}
