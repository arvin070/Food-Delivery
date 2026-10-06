import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { ModuleShell } from '@/components/ModuleShell';
import { plannedSectionsFor } from '@/lib/navigation';
import { requireRole } from '@/lib/session';

export const metadata: Metadata = { title: 'Institution' };

export default async function InstitutionPage() {
  const user = await requireRole([UserRole.INSTITUTION_ADMIN, UserRole.SUPER_ADMIN], '/institution');

  return (
    <ModuleShell
      title="Institution overview"
      subtitle={`Signed in as ${user.fullName}. Deliveries arriving at your checkpoints.`}
      moduleName="institution module"
      sections={plannedSectionsFor(UserRole.INSTITUTION_ADMIN)}
    />
  );
}
