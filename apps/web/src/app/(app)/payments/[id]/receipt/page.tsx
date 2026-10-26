import Link from 'next/link';
import { UserRole, formatCurrency } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import type { PaymentView, ReceiptView } from '@/components/payments/types';
import { PrintReceipt } from '@/components/payments/PrintReceipt';
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole([UserRole.CUSTOMER,UserRole.PARENT,UserRole.STUDENT], '/payments');
  const { id } = await params;
  const [receipt, payment] = await Promise.all([apiServer.get<ReceiptView>(`/payments/${id}/receipt`), apiServer.get<PaymentView>(`/payments/${id}`)]);
  const s = receipt.snapshot;
  return <article className="mx-auto max-w-3xl space-y-6 rounded border bg-white p-6"><Link href="/payments" className="text-brand-700 print:hidden">← Payments</Link><div><h1 className="text-2xl font-semibold">Payment receipt</h1>{s.provider === 'MOCK' && <p className="font-semibold text-amber-800">Development simulation — no money charged</p>}<p className="mt-2 text-sm">{receipt.number} · Issued {receipt.issuedAt.slice(0,10)}</p><p className="mt-2">{s.customerName} · Order {s.orderNumber}</p></div>
    <ul className="divide-y border-y">{s.items.map((item,i) => <li key={i} className="flex justify-between gap-3 py-3"><div>{item.quantity} × {item.meal}<p className="text-sm text-slate-500">{item.beneficiary} · {item.date} · {formatCurrency(item.unitPrice)} each</p></div><span>{formatCurrency(item.total)}</span></li>)}</ul>
    <dl className="space-y-2">{[['Subtotal',s.subtotal],['Delivery',s.deliveryFee],['Tax',s.taxAmount],['Discount',s.discountAmount],['Amount paid',s.amount]].map(([label,amount]) => <div key={label} className="flex justify-between"><dt>{label}</dt><dd>{formatCurrency(amount!)}</dd></div>)}</dl>
    <p className="text-sm">Provider: {s.provider} · Payment: {s.providerPaymentId}</p><p className="text-sm">Current payment status: {payment.status.toLowerCase().replaceAll('_',' ')} · Refunded: {formatCurrency(payment.refundedAmount)}</p><p className="text-xs text-slate-500">Receipt of payment. This document is not a GST tax invoice.</p><PrintReceipt />
  </article>;
}
