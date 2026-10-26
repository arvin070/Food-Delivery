'use client';
import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
type Membership = {
  id: string;
  institutionId: string;
  identifier: string | null;
  isActive: boolean;
  institution: { name: string };
};
export function InstitutionRegistration({
  institutions,
  initial,
}: {
  institutions: {
    id: string;
    name: string;
    registrationOpen: boolean;
    deliveryNotes: string | null;
  }[];
  initial: Membership[];
}) {
  const [members, setMembers] = useState(initial),
    [selected, setSelected] = useState(''),
    [identifier, setIdentifier] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function change(id: string, join: boolean) {
    setBusy(true);
    setError('');
    try {
      if (join)
        await apiClient.post('/v1/institutions/' + id + '/register', {
          identifier: identifier || null,
        });
      else await apiClient.delete('/v1/institutions/' + id + '/register');
      setMembers(
        await apiClient.get<Membership[]>('/v1/institutions/registrations/me'),
      );
    } catch (e) {
      setError(toFormErrors(e).formError ?? 'Could not update registration.');
    } finally {
      setBusy(false);
    }
  }
  const institution = institutions.find((i) => i.id === selected);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold">Your institutions</h1>
      <p className="text-slate-600">
        Register with your school, college, university or workplace. Parents can
        link a child through{' '}
        <Link href="/children" className="text-emerald-700">
          My children
        </Link>
        .
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <form
        className="space-y-4 rounded-xl border bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void change(selected, true);
        }}
      >
        <label className="block">
          Institution
          <select
            required
            className="mt-1 w-full rounded-lg border p-3"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select institution</option>
            {institutions.map((i) => (
              <option value={i.id} key={i.id}>
                {i.name}
                {!i.registrationOpen ? ' · Registration closed' : ''}
              </option>
            ))}
          </select>
        </label>
        {institution?.deliveryNotes && (
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">
            {institution.deliveryNotes}
          </p>
        )}
        <label className="block">
          Roll / employee number (optional)
          <input
            className="mt-1 w-full rounded-lg border p-3"
            value={identifier}
            maxLength={100}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </label>
        <Button
          type="submit"
          loading={busy}
          disabled={!institution?.registrationOpen}
        >
          Register
        </Button>
        {institution && (
          <Link
            className="ml-4 text-emerald-700"
            href={'/meals?institutionId=' + institution.id}
          >
            Browse institution meals →
          </Link>
        )}
      </form>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your registrations</h2>
        {!members.length && <p>No registrations yet.</p>}
        {members.map((m) => (
          <div
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
          >
            <div>
              <p className="font-medium">{m.institution.name}</p>
              <p className="text-sm text-slate-500">
                {m.identifier ?? 'No identifier'} ·{' '}
                {m.isActive ? 'Active' : 'Inactive'}
              </p>
            </div>
            {m.isActive && (
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() => change(m.institutionId, false)}
              >
                Leave institution
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
