'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ADMIN_SECTIONS,
  adminResources,
  administrativeActions,
  type AdminResource,
  type AdminDashboard,
  type AdminList,
  type AdminDetail,
  type AdminAction,
} from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
const field =
  'block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2';
function errorText(e: unknown) {
  const { formError, fields } = toFormErrors(e);
  return (
    formError ??
    Object.values(fields)[0] ??
    'The request could not be completed.'
  );
}
function human(value: string) {
  return value.toLowerCase().replaceAll('_', ' ');
}
function money(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
    }).format(Number(amount));
  } catch {
    return currency + ' ' + amount;
  }
}
export function AdminHome({ initial }: { initial: AdminDashboard }) {
  const [data, setData] = useState(initial),
    [date, setDate] = useState(initial.date),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      setData(
        await apiClient.get<AdminDashboard>('/v1/admin/dashboard?date=' + date),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const metrics = [
    ['Scheduled orders', data.metrics.orders, 'orders'],
    ['Scheduled meals', data.metrics.meals, 'orders'],
    ['Active users', data.metrics.activeUsers, 'users'],
    ['Active subscriptions', data.metrics.activeSubscriptions, 'subscriptions'],
    ['Active kitchens', data.metrics.activeKitchens, 'kitchens'],
    [
      'Active delivery partners',
      data.metrics.activeDeliveryPartners,
      'delivery-partners',
    ],
    ['Pending deliveries', data.metrics.pendingDeliveries, 'routes'],
    ['Failed deliveries', data.metrics.failedDeliveries, 'orders'],
  ] as const;
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">Super admin</p>
          <h1 className="mt-1 text-3xl font-semibold">Operations overview</h1>
          <Link href="/admin/analytics" className="mt-2 inline-block text-sm text-emerald-700">Analytics & reporting →</Link>
          <p className="mt-2 text-sm text-slate-500">
            Scheduled meals and collections for {data.date} · {data.timezone}
          </p>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void refresh();
          }}
        >
          <label className="text-sm">
            Reporting date
            <input
              className={field}
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <Button loading={busy} type="submit">
            Refresh
          </Button>
        </form>
      </header>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, value, section]) => (
          <Link
            key={label}
            href={'/admin/manage/' + section}
            className="rounded-xl border bg-white p-5 hover:border-emerald-400"
          >
            <p className="text-sm text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
          </Link>
        ))}
        <div className="rounded-xl bg-emerald-900 p-5 text-white">
          <p className="text-sm text-emerald-100">Net collections</p>
          {data.revenue.length ? (
            data.revenue.map((r) => (
              <div key={r.currency} className="mt-2">
                <p className="text-2xl font-semibold">
                  {money(r.net, r.currency)}
                </p>
                <p className="mt-1 text-xs text-emerald-100">
                  {money(r.collected, r.currency)} collected ·{' '}
                  {money(r.refunded, r.currency)} refunded
                </p>
              </div>
            ))
          ) : (
            <p className="mt-2 text-xl">No verified collections</p>
          )}
          <Link
            href="/admin/manage/payments"
            className="mt-3 inline-block text-sm underline"
          >
            Review payments
          </Link>
        </div>
      </section>
      <p className="text-xs text-slate-500">
        Meal totals exclude cancelled items. Pending deliveries count active
        delivery assignments. Active resource counts reflect current status.
        Collections include verified captured payments; refunds are counted on
        their processing date, separately by currency.
      </p>
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Administration</h2>
          <Link className="py-2 text-emerald-700" href="/admin/audit">
            Audit log →
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {adminResources.map((resource) => (
            <Link
              key={resource}
              href={'/admin/manage/' + resource}
              className="flex items-center justify-between rounded-lg border p-4 font-medium hover:bg-slate-50"
            >
              {ADMIN_SECTIONS[resource].label}
              <span aria-hidden>→</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
export function AdminBrowser({
  resource,
  cities,
}: {
  resource: AdminResource;
  cities: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [date, setDate] = useState(''),
    [city, setCity] = useState(''),
    [role, setRole] = useState(''),
    [available, setAvailable] = useState('');
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [data, setData] = useState<AdminList | null>(null),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    apiClient
      .get<AdminList>('/v1/admin/manage/' + resource + '?page=' + page + query)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [resource, page, query, reload]);
  function apply() {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries({
      search,
      status,
      date,
      cityId: city,
      role,
      available,
    }))
      if (value) q.set(key, value);
    setPage(1);
    setQuery('&' + q.toString());
    setReload((v) => v + 1);
  }
  const section = ADMIN_SECTIONS[resource];
  return (
    <div className="space-y-5">
      <Link className="inline-block py-2 text-emerald-700" href="/admin">
        ← Admin dashboard
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{section.label}</h1>
        {resource === 'routes' && (
          <Link href="/admin/routes" className="text-emerald-700">
            Plan & manage batches →
          </Link>
        )}
        {resource === 'vendors' && (
          <Link href="/admin/vendors" className="text-emerald-700">
            Vendor onboarding →
          </Link>
        )}
        {resource === 'checkpoints' && (
          <Link href="/admin/checkpoints/new" className="text-emerald-700">
            Add checkpoint →
          </Link>
        )}
      </header>
      <form
        className="grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="text-sm">
          Search
          <input
            className={field}
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, reference or details"
          />
        </label>
        <label className="text-sm">
          Status
          <select
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {section.statuses.map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          City
          <select
            className={field}
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {resource === 'orders' || resource === 'routes'
            ? 'Delivery date'
            : resource === 'subscriptions'
              ? 'Plan start or end date'
              : resource === 'payments' || resource === 'refunds'
                ? 'Transaction date'
                : 'Created date'}
          <input
            className={field}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {resource === 'users' && (
          <label className="text-sm">
            Role
            <select
              className={field}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">All roles</option>
              {[
                'SUPER_ADMIN',
                'CUSTOMER',
                'PARENT',
                'STUDENT',
                'VENDOR',
                'DELIVERY_PARTNER',
                'INSTITUTION_ADMIN',
              ].map((r) => (
                <option key={r} value={r}>
                  {human(r)}
                </option>
              ))}
            </select>
          </label>
        )}
        {resource === 'delivery-partners' && (
          <label className="text-sm">
            Availability
            <select
              className={field}
              value={available}
              onChange={(e) => setAvailable(e.target.value)}
            >
              <option value="">Any availability</option>
              <option value="true">Available</option>
              <option value="false">Unavailable</option>
            </select>
          </label>
        )}
        <div className="flex items-end gap-2">
          <Button type="submit">Search & filter</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSearch('');
              setStatus('');
              setDate('');
              setCity('');
              setRole('');
              setAvailable('');
              setQuery('');
              setPage(1);
              setReload((v) => v + 1);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading records…</p>}
      {data && !data.items.length && (
        <p className="rounded-xl border p-8 text-center text-slate-500">
          No matching records.
        </p>
      )}
      <ul className="divide-y rounded-xl border">
        {data?.items.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-4 p-4"
          >
            <div className="min-w-0">
              <h2 className="font-semibold">{row.name || row.id}</h2>
              <p className="break-words text-sm text-slate-600">
                {row.summary || '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">{human(row.status)}</p>
            </div>
            <Link
              className="rounded-lg border px-4 py-2 text-sm font-medium text-emerald-700"
              href={'/admin/manage/' + resource + '/' + row.id}
            >
              View & manage
            </Link>
          </li>
        ))}
      </ul>
      {data && (
        <nav className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm">
            {data.total} records · Page {page}
          </span>
          <Button
            variant="secondary"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
export function AdminRecordView({
  resource,
  initial,
}: {
  resource: AdminResource;
  initial: AdminDetail;
}) {
  const [data, setData] = useState(initial),
    [page, setPage] = useState(1),
    [action, setAction] = useState<AdminAction | ''>(''),
    [reason, setReason] = useState(''),
    [amount, setAmount] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const refundKey = useRef<{ signature: string; key: string } | null>(null);
  const record = data.record,
    actions = administrativeActions(resource, record.status);
  async function refresh(next = page) {
    setBusy(true);
    setError('');
    try {
      setData(
        await apiClient.get<AdminDetail>(
          '/v1/admin/manage/' + resource + '/' + record.id + '?page=' + next,
        ),
      );
      setPage(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError('');
    setNotice('');
    const signature = JSON.stringify({ action, reason, amount });
    if (refundKey.current?.signature !== signature)
      refundKey.current = { signature, key: crypto.randomUUID() };
    try {
      await apiClient.post(
        '/v1/admin/manage/' + resource + '/' + record.id + '/actions',
        {
          action,
          reason,
          expectedStatus: record.status,
          ...(resource === 'complaints' ? { revision: record.revision } : {}),
          ...(action === 'REFUND'
            ? {
                idempotencyKey: refundKey.current.key,
                ...(amount ? { amount } : {}),
              }
            : {}),
        },
      );
      setData(
        await apiClient.get<AdminDetail>(
          '/v1/admin/manage/' + resource + '/' + record.id,
        ),
      );
      setPage(1);
      setAction('');
      setReason('');
      setNotice(
        action === 'REFUND'
          ? 'Refund requested. Provider verification determines its final status.'
          : 'Change saved and recorded in the audit log.',
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={'/admin/manage/' + resource}
        className="inline-block py-2 text-emerald-700"
      >
        ← {ADMIN_SECTIONS[resource].label}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{record.name || record.id}</h1>
          <p className="mt-1 text-slate-600">{record.summary}</p>
          <p className="mt-2 inline-block rounded-lg bg-slate-100 px-3 py-1 text-sm">
            {human(record.status)}
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => refresh()}>
          Refresh
        </Button>
      </header>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-emerald-800"
        >
          {notice}
        </p>
      )}
      <dl className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
        {Object.entries(record.fields).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {key.replace(/([A-Z])/g, ' $1')}
            </dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
              {value === null
                ? '—'
                : typeof value === 'boolean'
                  ? value
                    ? 'Yes'
                    : 'No'
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-4 text-sm text-emerald-700">
        <Link href={'/admin/audit?search=' + record.id}>Audit history →</Link>
        {resource === 'routes' && (
          <Link href={'/admin/routes/' + record.id}>Open route planner →</Link>
        )}
        {resource === 'checkpoints' && (
          <Link href={'/admin/checkpoints/' + record.id + '/edit'}>
            Edit checkpoint →
          </Link>
        )}
        {typeof record.fields.orderId === 'string' && (
          <Link href={'/admin/manage/orders/' + record.fields.orderId}>
            View order →
          </Link>
        )}
        {typeof record.fields.paymentId === 'string' && (
          <Link href={'/admin/manage/payments/' + record.fields.paymentId}>
            View payment →
          </Link>
        )}
      </div>
      {actions.length > 0 && (
        <form
          className="space-y-4 rounded-xl border bg-slate-50 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          <h2 className="text-xl font-semibold">Administrative action</h2>
          <label className="block text-sm">
            Action
            <select
              className={field}
              required
              value={action}
              disabled={busy}
              onChange={(e) => setAction(e.target.value as AdminAction)}
            >
              <option value="">Choose action</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {human(a)}
                </option>
              ))}
            </select>
          </label>
          {action === 'REFUND' && (
            <label className="block text-sm">
              Refund amount (leave blank for remaining balance)
              <input
                className={field}
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
          <label className="block text-sm">
            {resource === 'complaints'
              ? 'Response to customer'
              : 'Reason for this change'}
            <textarea
              className={field}
              required
              minLength={3}
              maxLength={action === 'REFUND' ? 200 : 500}
              rows={3}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">
            This action, its reason, and your administrator identity will be
            recorded.
          </p>
          <Button
            type="submit"
            loading={busy}
            disabled={!action || reason.trim().length < 3}
            variant={
              ['SUSPEND', 'DEACTIVATE', 'CANCEL', 'REJECT'].includes(action)
                ? 'danger'
                : 'primary'
            }
          >
            {action === 'REFUND' ? 'Request refund' : 'Apply action'}
          </Button>
        </form>
      )}
      {data.relatedTotal > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Meal items</h2>
          {data.related.map((row) => (
            <div className="rounded-lg border p-4 text-sm" key={String(row.id)}>
              {Object.entries(row)
                .filter(([k]) => k !== 'id')
                .map(([key, value]) => (
                  <p key={key}>
                    <span className="font-medium">{key}: </span>
                    {String(value ?? '—')}
                  </p>
                ))}
            </div>
          ))}
          <nav className="flex justify-between">
            <Button
              variant="secondary"
              disabled={page === 1 || busy}
              onClick={() => refresh(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm">
              {data.relatedTotal} items · Page {page}
            </span>
            <Button
              variant="secondary"
              disabled={page * data.pageSize >= data.relatedTotal || busy}
              onClick={() => refresh(page + 1)}
            >
              Next
            </Button>
          </nav>
        </section>
      )}
      {!actions.length && (
        <p className="text-sm text-slate-500">
          This record is managed through its operational workflow.
        </p>
      )}
    </div>
  );
}
interface AuditPage {
  items: {
    id: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    before: unknown;
    after: unknown;
    createdAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
}
export function AuditBrowser({ initialSearch }: { initialSearch: string }) {
  const [search, setSearch] = useState(initialSearch),
    [query, setQuery] = useState(initialSearch),
    [page, setPage] = useState(1),
    [data, setData] = useState<AuditPage | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    apiClient
      .get<AuditPage>(
        '/v1/admin/audit?page=' + page + '&search=' + encodeURIComponent(query),
      )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [query, page]);
  return (
    <div className="space-y-5">
      <Link className="text-emerald-700" href="/admin">
        ← Admin dashboard
      </Link>
      <h1 className="text-3xl font-semibold">Audit log</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
          setPage(1);
        }}
      >
        <input
          aria-label="Search audit log"
          className={field}
          placeholder="Action, record ID or administrator ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading audit history…</p>}
      {data && !data.items.length && <p>No audit entries found.</p>}
      {data?.items.map((a) => (
        <article className="space-y-2 rounded-lg border p-4" key={a.id}>
          <h2 className="font-semibold">{a.action}</h2>
          <p className="break-all text-xs text-slate-500">
            {a.createdAt} · Actor {a.actorUserId ?? 'system'} · {a.entityType}{' '}
            {a.entityId}
          </p>
          <details>
            <summary className="cursor-pointer py-2 text-sm">
              Before & after
            </summary>
            <pre className="whitespace-pre-wrap break-words text-xs">
              {JSON.stringify({ before: a.before, after: a.after }, null, 2)}
            </pre>
          </details>
        </article>
      ))}
      {data && (
        <nav className="flex justify-between">
          <Button
            variant="secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm">{data.total} entries</span>
          <Button
            variant="secondary"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
