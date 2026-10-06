import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type Child } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { ChildCard } from '@/components/children/ChildCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'My children' };

export default async function ChildrenPage() {
  await requireRole([UserRole.PARENT, UserRole.CUSTOMER], '/children');

  const { children } = await apiServer.get<{ children: Child[] }>('/children');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My children</h1>
          <p className="mt-1 text-sm text-slate-500">
            {children.length > 0
              ? `You can order for any of them. Children don’t need their own account.`
              : 'Add a child to order meals on their behalf.'}
          </p>
        </div>
        <Link href="/children/new">
          <Button>Add a child</Button>
        </Link>
      </div>

      {children.length === 0 ? (
        <EmptyState
          title="No children added yet"
          description="Add your child’s school, usual checkpoint and any allergies, and ordering for them becomes a couple of taps."
          action={
            <Link href="/children/new">
              <Button>Add your first child</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {children.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}
        </ul>
      )}
    </div>
  );
}
