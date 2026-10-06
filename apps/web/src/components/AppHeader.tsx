import Link from 'next/link';
import type { PublicUser } from '@lunch/shared';
import { serverConfig } from '@/lib/config';
import { ROLE_LABELS, navItemsFor } from '@/lib/navigation';
import { MobileNav } from './MobileNav';
import { NavLink } from './NavLink';
import { SignOutButton } from './SignOutButton';

/**
 * The signed-in header.
 *
 * Navigation comes from `lib/navigation.ts` so the desktop bar, the mobile
 * panel and the role landing screens cannot drift apart. Below `sm` the inline
 * links are replaced by `MobileNav` rather than simply hidden.
 */
export function AppHeader({ user }: { user: PublicUser }) {
  const items = navItemsFor(user.role);
  const roleLabel = ROLE_LABELS[user.role];

  return (
    <header className="relative border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {serverConfig.appName}
        </Link>

        <nav aria-label="Main" className="hidden gap-1 sm:flex">
          {items.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-slate-900">{user.fullName}</p>
            <p className="text-xs leading-tight text-slate-500">{roleLabel}</p>
          </div>
          <SignOutButton />
          <MobileNav items={items} userName={user.fullName} roleLabel={roleLabel} />
        </div>
      </div>
    </header>
  );
}
