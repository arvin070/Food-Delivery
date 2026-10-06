import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionOptional, homePathForRole } from '@/lib/session';
import { serverConfig } from '@/lib/config';

/** Signed-in users have no business on the sign-in screens. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Optional on purpose: if the API is unreachable, still render the form so the
  // user gets an actionable message on submit rather than a 500 page here.
  const user = await getSessionOptional();
  if (user) redirect(homePathForRole(user.role));

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-md">
        <Link href="/" className="block text-center text-2xl font-bold tracking-tight text-brand-600">
          {serverConfig.appName}
        </Link>
        <p className="mt-1 text-center text-sm text-slate-500">
          Scheduled meals, delivered to your checkpoint
        </p>
        <div className="mt-8 rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-slate-200 sm:px-10">
          {children}
        </div>
      </div>
    </div>
  );
}
