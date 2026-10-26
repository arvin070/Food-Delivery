import Link from 'next/link';
import { UserRole, formatCurrency } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { SubscriptionControls } from '@/components/subscriptions/SubscriptionControls';
import { planLabels, type SubscriptionDetail } from '@/components/subscriptions/types';
export default async function SubscriptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  await requireRole([UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT, UserRole.SUPER_ADMIN], '/subscriptions');
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const sub = await apiServer.get<SubscriptionDetail>(`/subscriptions/${id}?page=${page}`);
  const time = new Date(Date.UTC(2000,0,1,0,sub.timeSlot.startMinute)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return <div className="space-y-6"><Link href="/subscriptions" className="text-brand-700">← Subscriptions</Link><div><h1 className="text-2xl font-semibold">{planLabels[sub.plan]} · {sub.meal.name}</h1><p className="mt-2">{sub.child?.fullName ?? 'Me'} · {sub.checkpoint.name} · {time} ({sub.timeSlot.label})</p><p className="mt-1 text-sm text-slate-500">{sub.status.toLowerCase()} · {sub.quantity} meal(s) per date · {formatCurrency(sub.pricePerMeal)} each</p><p className="text-sm text-slate-500">{sub.startDate.slice(0,10)} — {sub.endDate?.slice(0,10) ?? 'Until cancelled'} · {sub.daysOfWeek.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d-1]).join(', ')}</p></div>
    <SubscriptionControls id={id} status={sub.status} />
    <section><h2 className="text-lg font-semibold">Upcoming meals</h2><p className="mt-1 text-sm text-slate-500">Booked meals appear here. Meals are booked up to seven days ahead; holidays, skipped dates and unavailable meals are excluded.</p>{sub.upcoming.length === 0 && <p className="mt-3">No upcoming meals booked. Use “Book upcoming meals” to check availability.</p>}<ul className="divide-y">{sub.upcoming.map(item => <li key={item.id} className="py-3"><Link className="text-brand-700" href={`/orders/${item.order.id}`}>{item.serviceDate.slice(0,10)} · {item.mealNameSnapshot} · {item.beneficiaryName}</Link><span className="ml-2 text-sm">{item.status.toLowerCase()}</span></li>)}</ul></section>
    {sub.skips.length > 0 && <p className="text-sm">Skipped dates: {sub.skips.map(s => s.serviceDate.slice(0,10)).join(', ')}</p>}
    <section><h2 className="text-lg font-semibold">Subscription history</h2><ul className="divide-y">{sub.history.map(item => <li key={item.id} className="py-2"><Link href={`/orders/${item.order.id}`}>{item.serviceDate.slice(0,10)} · {item.order.orderNumber} · {item.status.toLowerCase()}</Link></li>)}</ul><ul className="mt-4 space-y-2 text-sm text-slate-600">{sub.events.map(event => <li key={event.id}>{event.createdAt.slice(0,10)} · {event.action.toLowerCase()}{event.serviceDate ? ` · ${event.serviceDate.slice(0,10)}` : ''}</li>)}</ul><div className="mt-4 flex gap-4">{page > 1 && <Link href={`?page=${page-1}`}>Previous</Link>}{(sub.history.length === 20 || sub.events.length === 20) && <Link href={`?page=${page+1}`}>More history</Link>}</div></section>
  </div>;
}
