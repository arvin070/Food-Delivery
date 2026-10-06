import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type VendorSummary } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { VendorAdminList } from '@/components/vendor/VendorAdminList';

export const metadata: Metadata = { title: 'Vendors' };

export default async function AdminVendorsPage() {
  await requireRole([UserRole.SUPER_ADMIN], '/admin/vendors');

  const vendors = await apiServer.get<VendorSummary[]>('/admin/vendors?pageSize=100');

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Vendors</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create vendors, approve applications, and suspend or restore accounts.
        </p>
      </div>

      <VendorAdminList vendors={vendors} />
    </div>
  );
}
