'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await apiClient.post('/v1/auth/logout', {});
    } catch {
      setError('Sign out failed. Your session is still active. Please retry.');
      setBusy(false);
      return;
    }
    router.refresh();
    router.replace('/login');
  }

  return (
    <div><Button variant="ghost" size="sm" loading={busy} onClick={signOut}>
      Sign out
    </Button>{error && <p role="alert" className="text-xs text-red-700">{error}</p>}</div>
  );
}
