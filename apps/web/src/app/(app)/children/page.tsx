import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { ModuleShell } from '@/components/ModuleShell';
import { plannedSectionsFor } from '@/lib/navigation';
import { requireRole } from '@/lib/session';

export const metadata: Metadata = { title: 'My children' };

/** Parents manage the children they order for. */
export default async function ChildrenPage() {
  await requireRole([UserRole.PARENT, UserRole.SUPER_ADMIN], '/children');

  return (
    <ModuleShell
      title="My children"
      subtitle="Each child, their institution, their usual checkpoint and any allergies."
      moduleName="profile and child-management module"
      sections={plannedSectionsFor(UserRole.PARENT)}
    />
  );
}
