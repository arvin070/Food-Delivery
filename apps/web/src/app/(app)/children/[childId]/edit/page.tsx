import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UserRole, type Child } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { loadFormReferenceData } from '@/lib/reference.server';
import { requireRole } from '@/lib/session';
import { ChildForm } from '@/components/children/ChildForm';

export const metadata: Metadata = { title: 'Edit child' };

export default async function EditChildPage({
  params,
}: {
  params: Promise<{ childId: string }>;
}) {
  const { childId } = await params;
  await requireRole([UserRole.PARENT, UserRole.CUSTOMER], `/children/${childId}/edit`);

  let child: Child;
  try {
    ({ child } = await apiServer.get<{ child: Child }>(`/children/${childId}`));
  } catch (err) {
    // The API scopes by parent, so someone else's child is a 404 here too.
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  }

  const reference = await loadFormReferenceData();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/children" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← My children
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          Edit {child.fullName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Changes apply to new orders. Orders already placed keep the details they were made with.
        </p>
      </div>

      <ChildForm child={child} reference={reference} />
    </div>
  );
}
