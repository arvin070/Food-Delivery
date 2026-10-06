import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionOptional, homePathForRole } from '@/lib/session';
import { serverConfig } from '@/lib/config';
import { Button } from '@/components/ui/Button';

const CHECKPOINTS = [
  'College gate',
  'School gate',
  'Bus checkpoint',
  'Office reception',
  'Hostel',
  'Apartment community point',
];

export default async function LandingPage() {
  const user = await getSessionOptional();
  if (user) redirect(homePathForRole(user.role));

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <span className="text-lg font-bold tracking-tight text-brand-600">
            {serverConfig.appName}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Meals, scheduled ahead and delivered to a checkpoint
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
          Lunch is not instant delivery. Book a meal for a future date and time slot, and we bring
          it to a place you already go — not a street address.
        </p>

        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register">
            <Button size="lg">Create an account</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>

        <section className="mt-16 text-left">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-slate-500">
            Delivered to
          </h2>
          <ul className="mx-auto mt-5 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
            {CHECKPOINTS.map((label) => (
              <li
                key={label}
                className="rounded-lg bg-white px-3 py-3 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-200"
              >
                {label}
              </li>
            ))}
          </ul>
          <p className="mt-8 text-center text-sm text-slate-500">
            Parents can order for their children and get a confirmation the moment the meal is
            handed over.
          </p>
        </section>
      </main>
    </div>
  );
}
