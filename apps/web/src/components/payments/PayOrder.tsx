'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';
interface Checkout { provider: string; key: string | null; orderId: string; amount: number; currency: string }
interface GatewayResult { razorpay_payment_id: string; razorpay_signature: string }
interface Gateway { open(): void; on(event: string, callback: () => void): void }
declare global { interface Window { Razorpay?: new (options: Record<string,unknown>) => Gateway } }
async function loadCheckout() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve,reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    script.onload = () => resolve(); script.onerror = () => reject(new Error('Payment checkout could not load. Please retry.'));
    document.head.appendChild(script);
  });
  if (!window.Razorpay) throw new Error('Payment checkout is unavailable');
}
export function PayOrder({ orderId, canPay }: { orderId: string; canPay: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mockId, setMockId] = useState<string>();
  async function simulate(status: 'captured' | 'failed' | 'cancelled') {
    setBusy(true);
    try { await apiClient.post(`/v1/payments/${mockId}/simulate`, { status }); setMessage(`Test payment ${status}. No money was charged.`); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not check payment'); }
    finally { setBusy(false); }
  }
  async function pay() {
    setBusy(true); setMessage('');
    try {
      const result = await apiClient.post<{ payment: { id: string }; checkout: Checkout }>('/v1/payments', { orderId });
      if (result.checkout.provider === 'MOCK') { setMockId(result.payment.id); setBusy(false); return; }
      await loadCheckout();
      const refresh = async () => {
        try { await apiClient.post(`/v1/payments/${result.payment.id}/refresh`); router.refresh(); }
        catch { setMessage('Payment status is still being checked. Visit payment history for updates.'); }
        finally { setBusy(false); }
      };
      const gateway = new window.Razorpay!({
        key: result.checkout.key, order_id: result.checkout.orderId,
        amount: result.checkout.amount, currency: result.checkout.currency, name: 'Lunch',
        description: 'Meal order',
        handler: async (response: GatewayResult) => {
          try {
            const payment = await apiClient.post<{ status: string }>(`/v1/payments/${result.payment.id}/verify`, { providerPaymentId: response.razorpay_payment_id, signature: response.razorpay_signature });
            setMessage(payment.status === 'PAID' ? 'Payment verified.' : 'Payment is awaiting provider confirmation.'); router.refresh();
          } catch (e) { setMessage(e instanceof Error ? e.message : 'Verification is pending. Check payment history.'); }
          finally { setBusy(false); }
        },
        modal: { ondismiss: refresh },
      });
      gateway.on('payment.failed', () => { setMessage('Payment was unsuccessful. You can retry or check payment history.'); void refresh(); });
      gateway.open();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not start payment'); setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border border-slate-200 p-4">
    <h2 className="font-semibold">Payment</h2>
    {canPay && <><p className="text-sm text-slate-600">Pay by UPI, card, net banking or a supported wallet in secure provider checkout. Your order is confirmed after payment verification.</p><Button loading={busy} onClick={pay}>Pay securely</Button></>}
    {mockId && canPay && <div className="space-y-2 rounded bg-amber-50 p-3"><p className="text-sm font-semibold">Development payment simulator — no real charge</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => simulate('captured')}>Simulate success</Button><Button disabled={busy} variant="secondary" onClick={() => simulate('failed')}>Simulate failure</Button><Button disabled={busy} variant="secondary" onClick={() => simulate('cancelled')}>Simulate cancellation</Button></div></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <Link className="block text-sm font-semibold text-brand-700" href="/payments">Payment history, refunds and receipts →</Link>
  </section>;
}
