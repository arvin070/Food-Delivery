'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Search box that writes to the URL, debounced so typing is not a request each. */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('search') ?? '');

  useEffect(() => {
    const current = params.get('search') ?? '';
    if (value === current) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('search', value.trim());
      else next.delete('search');
      next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    }, 350);

    return () => clearTimeout(timer);
  }, [value, params, pathname, router]);

  return (
    <div>
      <label htmlFor="catalog-search" className="sr-only">
        Search meals
      </label>
      <input
        id="catalog-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search dishes, cuisines or ingredients"
        className="w-full rounded-md border-0 py-2.5 px-3.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 sm:text-sm"
      />
    </div>
  );
}
