import { UserRole } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { InstitutionRegistration } from '@/components/institutions/InstitutionRegistration';
export const metadata = { title: 'Your institutions' };
export default async function Page() {
  await requireRole(
    [UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT],
    '/institutions',
  );
  const [{ institutions }, initial] = await Promise.all([
    apiServer.get<{
      institutions: {
        id: string;
        name: string;
        registrationOpen: boolean;
        deliveryNotes: string | null;
      }[];
    }>('/reference/institutions'),
    apiServer.get<
      {
        id: string;
        institutionId: string;
        identifier: string | null;
        isActive: boolean;
        institution: { name: string };
      }[]
    >('/institutions/registrations/me'),
  ]);
  return (
    <InstitutionRegistration institutions={institutions} initial={initial} />
  );
}
