import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Use your email address or phone number.</p>

      {reset && (
        <div className="mt-4">
          <Alert tone="success" title="Password updated">
            Sign in with your new password. Any other devices were signed out.
          </Alert>
        </div>
      )}

      <div className="mt-6">
        <LoginForm nextPath={next} />
      </div>

      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700">
          Forgot your password?
        </Link>
      </p>

      <p className="mt-6 text-center text-sm text-slate-500">
        New to Lunch?{' '}
        <Link href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
          Create an account
        </Link>
      </p>
    </>
  );
}
