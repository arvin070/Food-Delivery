import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        We couldn’t find that page
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        The link may be out of date, or the page may have moved.
      </p>
      <Link href="/" className="mt-6">
        <Button>Back to start</Button>
      </Link>
    </div>
  );
}
