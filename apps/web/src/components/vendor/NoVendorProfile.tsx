import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';

/**
 * Shown when the signed-in account has no vendor record.
 *
 * This is the normal case for an administrator opening a vendor screen: the
 * vendor surfaces are scoped to "the vendor you operate", and an admin operates
 * none. They reach a specific business through the vendor list instead. It also
 * covers a VENDOR-role account whose vendor record was removed.
 */
export function NoVendorProfile({ isAdmin }: { isAdmin: boolean }) {
  if (isAdmin) {
    return (
      <EmptyState
        title="Pick a vendor first"
        description="These screens show the vendor you operate, and an admin account operates none. Open a business from the vendor list to review it."
        action={
          <Link href="/admin/vendors">
            <Button>Go to vendors</Button>
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      title="No vendor account linked"
      description="This account has the vendor role but no vendor record. Contact support so it can be set up."
    />
  );
}
