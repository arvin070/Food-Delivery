import Link from 'next/link';
import { UserRole, formatCurrency } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { PaymentActions } from '@/components/payments/PaymentActions';
import type { PaymentView } from '@/components/payments/types';
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole([UserRole.CUSTOMER,UserRole.PARENT,UserRole.STUDENT], '/payments');
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const payments = await apiServer.get<PaymentView[]>(`/payments?page=${page}`);
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Payments and receipts</h1><p className="text-sm text-slate-500">Verified payment status, refund progress and receipts for your orders.</p>
    {payments.length === 0 && <p>No payments on this page. <Link href="/orders" className="text-brand-700">View orders</Link></p>}
    <ul className="divide-y border-y">{payments.map(p => <li key={p.id} className="space-y-3 py-5"><div className="flex flex-wrap justify-between gap-2"><Link href={`/orders/${p.orderId}`} className="font-semibold text-brand-700">{p.order.orderNumber}</Link><span>{formatCurrency(p.amount)} · {p.status.toLowerCase().replaceAll('_',' ')}</span></div><p className="text-sm text-slate-500">{p.provider === 'MOCK' ? 'Development simulation' : p.provider} · {p.createdAt.slice(0,10)}{p.method ? ` · ${p.method}` : ''}</p>
      {p.failureReason && <p className="text-sm text-red-700">{p.failureReason}</p>}
      <PaymentActions id={p.id} refundable={['CANCELLED','FAILED'].includes(p.order.status) && ['PAID','PARTIALLY_REFUNDED'].includes(p.status)} />
      {p.receipt && <Link className="inline-block text-sm font-semibold text-brand-700" href={`/payments/${p.id}/receipt`}>View receipt</Link>}
      {p.attempts.length > 0 && <details className="text-sm"><summary>Payment attempts</summary><ul className="mt-2 space-y-1">{p.attempts.map(a => <li key={a.providerPaymentId}>{a.observedAt.slice(0,10)} · {a.method} · {a.status.toLowerCase()}</li>)}</ul></details>}
      {p.refunds.length > 0 && <ul aria-label="Refunds" className="space-y-1 text-sm">{p.refunds.map(r => <li key={r.id}>Refund {formatCurrency(r.amount)} · {r.status.toLowerCase()} · {r.reason}</li>)}</ul>}
    </li>)}</ul><div className="flex gap-4">{page > 1 && <Link href={`?page=${page-1}`}>Previous</Link>}{payments.length === 20 && <Link href={`?page=${page+1}`}>Next</Link>}</div>
  </div>;
}
