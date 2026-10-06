'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * A header link that knows whether it is the current page.
 *
 * Client-side because it reads the pathname; the header around it stays a
 * server component.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // A section is current when its own page or any page beneath it is open.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'rounded-md px-3 py-2 text-sm font-medium transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}
