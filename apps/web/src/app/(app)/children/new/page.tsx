import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole } from '@lunch/shared';
import { loadFormReferenceData } from '@/lib/reference.server';
import { requireRole } from '@/lib/session';
import { ChildForm } from '@/components/children/ChildForm';

export const metadata: Metadata = { title: 'Add a child' };

export default async function AddChildPage() {
  await requireRole([UserRole.PARENT, UserRole.CUSTOMER], '/children/new');
  const reference = await loadFormReferenceData();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/children" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← My children
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Add a child</h1>
        <p className="mt-1 text-sm text-slate-500">
          They do not need their own account — you order and we deliver to their checkpoint.
        </p>
      </div>

      <ChildForm reference={reference} />
    </div>
  );
}
