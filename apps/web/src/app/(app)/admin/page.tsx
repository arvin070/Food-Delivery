import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole } from '@lunch/shared';
import { ModuleShell } from '@/components/ModuleShell';
import { ROLE_SURFACES, plannedSectionsFor } from '@/lib/navigation';
import { requireRole } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminPage() {
  await requireRole([UserRole.SUPER_ADMIN], '/admin');

  return (
    <ModuleShell
      title="Admin dashboard"
      subtitle="Users, vendors, kitchens, delivery partners, orders, checkpoints and time slots."
      moduleName="admin module"
      sections={plannedSectionsFor(UserRole.SUPER_ADMIN)}
    >
      <section>
        <h2 className="text-sm font-semibold text-slate-900">Operational surfaces</h2>
        <p className="mt-1 text-sm text-slate-500">
          The four role-facing surfaces. As an admin you can open any of them.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {ROLE_SURFACES.map((surface) => (
            <li key={surface.href}>
              <Link
                href={surface.href}
                className="inline-flex rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {surface.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </ModuleShell>
  );
}
