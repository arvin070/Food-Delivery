import Link from 'next/link';
import { UserRole } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { planLabels, type SubscriptionView } from '@/components/subscriptions/types';
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole([UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT, UserRole.SUPER_ADMIN], '/subscriptions');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const rows = await apiServer.get<SubscriptionView[]>(`/subscriptions?page=${page}`);
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold">Meal subscriptions</h1><p className="mt-1 text-sm text-slate-500">Manage your plans and upcoming meals.</p></div><Link className="font-semibold text-brand-700" href="/meals">Choose a meal to subscribe →</Link>
    {rows.length === 0 && <p>No subscriptions on this page. Choose a meal and checkpoint to start a plan.</p>}
    <ul className="divide-y border-y">{rows.map(sub => <li key={sub.id}><Link href={`/subscriptions/${sub.id}`} className="block space-y-1 py-4"><p className="font-semibold">{planLabels[sub.plan]} · {sub.meal.name}</p><p className="text-sm">{sub.child?.fullName ?? 'Me'} · {sub.checkpoint.name} · {sub.timeSlot.label}</p><p className="text-sm text-slate-500">{sub.status.toLowerCase()} · From {sub.startDate.slice(0,10)}{sub.endDate ? ` to ${sub.endDate.slice(0,10)}` : ''}</p></Link></li>)}</ul>
    <div className="flex gap-4">{page > 1 && <Link href={`?page=${page-1}`}>Previous</Link>}{rows.length === 20 && <Link href={`?page=${page+1}`}>Next</Link>}</div>
  </div>;
}
