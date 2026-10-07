import type { Metadata } from 'next';
import { UserRole, type Child } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { CheckpointPicker } from '@/components/checkpoints/CheckpointPicker';

export const metadata: Metadata = { title: 'Checkpoints' };

export default async function CheckpointsPage() {
  await requireRole(
    [UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT],
    '/checkpoints'
  );

  // Load the user's children so they can assign a default per child.
  const childrenResult = await apiServer
    .get<{ children: Child[] }>('/children')
    .catch(() => ({ children: [] as Child[] }));

  const children = childrenResult.children;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Delivery checkpoints
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose a designated delivery point for your orders. Meals will be waiting for you there
          at your selected time.
        </p>
      </div>

      {/* User's own default */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">My default checkpoint</h2>
        <p className="mt-1 text-sm text-slate-500">
          Pre-fills at checkout for any order you place for yourself.
        </p>
        <div className="mt-4">
          <CheckpointPicker />
        </div>
      </section>

      {/* Per-child defaults */}
      {children.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Default checkpoints for my children
          </h2>
          <p className="text-sm text-slate-500">
            Set a different delivery point for each child. The school or hostel gate they use
            every day can be their default so ordering is one tap.
          </p>
          {children.map((child) => (
            <div key={child.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900">{child.fullName}</h3>
                {child.institution && (
                  <p className="text-xs text-slate-500">{child.institution.name}</p>
                )}
                {child.defaultCheckpoint && (
                  <p className="mt-1 text-xs text-green-700">
                    Current default: <strong>{child.defaultCheckpoint.name}</strong>
                  </p>
                )}
              </div>
              <CheckpointPicker
                childId={child.id}
                defaultCheckpointId={child.defaultCheckpoint?.id}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
