import Link from 'next/link';
import type { PublicUser, UserRole } from '@lunch/shared';
import { serverConfig } from '@/lib/config';
import { SignOutButton } from './SignOutButton';

/** Navigation per role. Links to modules not yet built are simply absent. */
const NAV_BY_ROLE: Record<UserRole, { href: string; label: string }[]> = {
  CUSTOMER: [{ href: '/meals', label: 'Browse meals' }],
  STUDENT: [{ href: '/meals', label: 'Browse meals' }],
  PARENT: [
    { href: '/meals', label: 'Browse meals' },
    { href: '/children', label: 'My children' },
  ],
  VENDOR: [{ href: '/vendor', label: 'Kitchen' }],
  DELIVERY_PARTNER: [{ href: '/delivery', label: 'Deliveries' }],
  INSTITUTION_ADMIN: [{ href: '/institution', label: 'Institution' }],
  SUPER_ADMIN: [{ href: '/admin', label: 'Admin' }],
};

const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: 'Customer',
  PARENT: 'Parent',
  STUDENT: 'Student',
  VENDOR: 'Vendor',
  DELIVERY_PARTNER: 'Delivery partner',
  INSTITUTION_ADMIN: 'Institution admin',
  SUPER_ADMIN: 'Admin',
};

export function AppHeader({ user }: { user: PublicUser }) {
  const nav = NAV_BY_ROLE[user.role] ?? [];

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold tracking-tight text-brand-600">
          {serverConfig.appName}
        </Link>

        <nav aria-label="Main" className="hidden gap-1 sm:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-slate-900">{user.fullName}</p>
            <p className="text-xs leading-tight text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
