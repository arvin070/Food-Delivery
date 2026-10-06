import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Enter your reset code' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ identifier?: string; sentTo?: string; devCode?: string }>;
}) {
  const { identifier, sentTo, devCode } = await searchParams;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Enter your code</h1>
      <p className="mt-1 text-sm text-slate-500">
        {sentTo
          ? `If an account exists, we sent a 6-digit code to ${sentTo}.`
          : 'Enter the 6-digit code we sent you, and choose a new password.'}
      </p>

      <div className="mt-6">
        <ResetPasswordForm
          identifier={identifier ?? ''}
          devCode={devCode}
        />
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Didn’t get a code?{' '}
        <Link href="/forgot-password" className="font-semibold text-brand-600 hover:text-brand-700">
          Request a new one
        </Link>
      </p>
    </>
  );
}
