'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';
export function PaymentActions({ id, refundable }: { id: string; refundable: boolean }) {
  const router = useRouter();
  const refundKey = useRef<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(refund: boolean) {
    setBusy(true); setMessage('');
    try {
      if (refund) {
        refundKey.current ??= crypto.randomUUID();
        await apiClient.post(`/v1/payments/${id}/refunds`, { idempotencyKey: refundKey.current, reason: 'Customer requested refund for cancelled order' });
        setMessage('Refund request recorded. Status will update after provider verification.');
      } else {
        await apiClient.post(`/v1/payments/${id}/refresh`);
        setMessage('Payment status checked with the provider.');
      }
      router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update payment'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 print:hidden"><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={() => run(false)}>Check payment status</Button>{refundable && <Button size="sm" disabled={busy} onClick={() => run(true)}>Request refund</Button>}</div>{message && <p role="status" className="text-sm">{message}</p>}</div>;
}
