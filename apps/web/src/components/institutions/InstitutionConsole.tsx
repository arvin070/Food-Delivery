'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  institutionTypes,
  type InstitutionSummary,
  type InstitutionDetail,
  type InstitutionRegistration,
  type InstitutionStatistics,
  type InstitutionBulkRequest,
  type CheckpointSummary,
  type CheckpointDetail,
} from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
const field =
  'mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5';
const box = 'space-y-4 rounded-xl border bg-white p-5';
const message = (e: unknown) =>
  toFormErrors(e).formError ?? 'Could not complete this request.';
const types = () =>
  institutionTypes.map((t) => (
    <option key={t} value={t}>
      {t === 'CORPORATE'
        ? 'Corporate office'
        : t.charAt(0) + t.slice(1).toLowerCase()}
    </option>
  ));
const value = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const nullable = (f: FormData, k: string) => value(f, k) || null;
function profile(f: FormData) {
  return {
    name: value(f, 'name'),
    type: value(f, 'type'),
    contactName: nullable(f, 'contactName'),
    contactEmail: nullable(f, 'contactEmail'),
    contactPhone: nullable(f, 'contactPhone'),
    deliveryNotes: nullable(f, 'deliveryNotes'),
    registrationOpen: f.get('registrationOpen') === 'on',
  };
}
function ProfileFields({ record }: { record?: InstitutionDetail }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Name
          <input
            className={field}
            name="name"
            required
            minLength={2}
            maxLength={160}
            defaultValue={record?.name}
          />
        </label>
        <label>
          Institution type
          <select
            className={field}
            name="type"
            defaultValue={record?.type ?? 'COLLEGE'}
          >
            {types()}
          </select>
        </label>
        <label>
          Contact name
          <input
            className={field}
            name="contactName"
            maxLength={120}
            defaultValue={record?.contactName ?? ''}
          />
        </label>
        <label>
          Contact email
          <input
            className={field}
            type="email"
            name="contactEmail"
            defaultValue={record?.contactEmail ?? ''}
          />
        </label>
        <label>
          Contact phone
          <input
            className={field}
            name="contactPhone"
            maxLength={30}
            defaultValue={record?.contactPhone ?? ''}
          />
        </label>
      </div>
      <label className="block">
        Delivery guidance & institution notice
        <textarea
          className={field}
          name="deliveryNotes"
          rows={3}
          maxLength={1500}
          defaultValue={record?.deliveryNotes ?? ''}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          name="registrationOpen"
          type="checkbox"
          defaultChecked={record?.registrationOpen ?? true}
        />
        Accept new self-registrations
      </label>
    </>
  );
}
export function InstitutionConsole({
  initial,
  superAdmin,
}: {
  initial: Page<InstitutionSummary>;
  superAdmin: boolean;
}) {
  const [list, setList] = useState(initial),
    [selected, setSelected] = useState(initial.items[0]?.id ?? ''),
    [search, setSearch] = useState(''),
    [error, setError] = useState('');
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]),
    [admins, setAdmins] = useState<{ id: string; name: string }[]>([]),
    [adminSearch, setAdminSearch] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (superAdmin)
      apiClient
        .get<{ cities: { id: string; name: string }[] }>('/v1/reference/cities')
        .then((r) => setCities(r.cities))
        .catch((e) => setError(message(e)));
  }, [superAdmin]);
  async function load(page = 1) {
    try {
      setList(
        await apiClient.get<Page<InstitutionSummary>>(
          '/v1/institutions?' +
            new URLSearchParams({ page: String(page), search }),
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function findAdmins() {
    try {
      const r = await apiClient.get<{ items: { id: string; name: string }[] }>(
        '/v1/admin/manage/users?role=INSTITUTION_ADMIN&status=ACTIVE&search=' +
          encodeURIComponent(adminSearch),
      );
      setAdmins(r.items);
    } catch (e) {
      setError(message(e));
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const r = await apiClient.post<InstitutionDetail>('/v1/institutions', {
        ...profile(f),
        cityId: value(f, 'cityId'),
        adminUserId: value(f, 'adminUserId'),
      });
      setSelected(r.id);
      form.reset();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Institution management</h1>
        <p className="mt-2 text-slate-600">
          Coordinate campus checkpoints, delivery windows and meal demand.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <section className={box}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="Search institutions"
            className={field}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your institutions"
          />
          <Button type="submit">Search</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {list.items.map((i) => (
            <Button
              key={i.id}
              variant={selected === i.id ? 'primary' : 'secondary'}
              onClick={() => setSelected(i.id)}
            >
              {i.name} · {i.city.name}
            </Button>
          ))}
        </div>
        {!list.total && (
          <p>
            No institutions assigned. A super admin can create an institution
            and assign an institution administrator.
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={list.page === 1}
            onClick={() => load(list.page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm">{list.total} institutions</span>
          <Button
            variant="ghost"
            disabled={list.page * 25 >= list.total}
            onClick={() => load(list.page + 1)}
          >
            Next
          </Button>
        </div>
      </section>
      {superAdmin && (
        <details className={box}>
          <summary className="cursor-pointer font-semibold">
            Create institution
          </summary>
          <div className="flex gap-2">
            <input
              aria-label="Find administrator"
              className={field}
              placeholder="Administrator name or email"
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
            />
            <Button onClick={findAdmins} variant="secondary">
              Find admin
            </Button>
          </div>
          <form onSubmit={create} className="space-y-4">
            <ProfileFields />
            <label className="block">
              City
              <select className={field} name="cityId" required>
                <option value="">Select city</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Institution administrator
              <select className={field} name="adminUserId" required>
                <option value="">Find and select an administrator</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" loading={busy}>
              Create institution
            </Button>
          </form>
        </details>
      )}
      {selected && <InstitutionWorkspace key={selected} id={selected} />}
    </div>
  );
}
function InstitutionWorkspace({ id }: { id: string }) {
  const [record, setRecord] = useState<InstitutionDetail | null>(null),
    [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]),
    [checkpointPage, setCheckpointPage] = useState(1),
    [checkpointId, setCheckpointId] = useState(''),
    [checkpoint, setCheckpoint] = useState<CheckpointDetail | null>(null);
  const [stats, setStats] = useState<InstitutionStatistics | null>(null),
    [date, setDate] = useState(''),
    [registrations, setRegistrations] =
      useState<Page<InstitutionRegistration> | null>(null),
    [search, setSearch] = useState(''),
    [bulk, setBulk] = useState<Page<InstitutionBulkRequest> | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const bulkKey = useRef<{ body: string; key: string } | null>(null);
  const base = '/v1/institutions/' + id;
  async function members(page = 1) {
    setRegistrations(
      await apiClient.get<Page<InstitutionRegistration>>(
        base +
          '/registrations?' +
          new URLSearchParams({ page: String(page), search }),
      ),
    );
  }
  async function loadCheckpoints(page = 1) {
    const rows = await apiClient.get<CheckpointSummary[]>(
      '/v1/checkpoints?' +
        new URLSearchParams({
          institutionId: id,
          page: String(page),
          pageSize: '25',
        }),
    );
    setCheckpoints(rows);
    setCheckpointPage(page);
  }
  async function loadCheckpoint(cp: string) {
    setCheckpoint(
      (
        await apiClient.get<{ checkpoint: CheckpointDetail }>(
          '/v1/checkpoints/' + cp,
        )
      ).checkpoint,
    );
  }
  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (success) setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    Promise.all([
      apiClient.get<InstitutionDetail>(base),
      apiClient.get<InstitutionStatistics>(base + '/statistics'),
      apiClient.get<Page<InstitutionRegistration>>(base + '/registrations'),
      apiClient.get<Page<InstitutionBulkRequest>>(base + '/bulk-requests'),
      apiClient.get<CheckpointSummary[]>(
        '/v1/checkpoints?institutionId=' + id + '&pageSize=25',
      ),
    ])
      .then(([r, s, m, b, c]) => {
        if (live) {
          setRecord(r);
          setStats(s);
          setDate(s.date);
          setRegistrations(m);
          setBulk(b);
          setCheckpoints(c);
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [base, id]);
  useEffect(() => {
    let live = true;
    setCheckpoint(null);
    if (checkpointId)
      apiClient
        .get<{ checkpoint: CheckpointDetail }>(
          '/v1/checkpoints/' + checkpointId,
        )
        .then((r) => {
          if (live) setCheckpoint(r.checkpoint);
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    return () => {
      live = false;
    };
  }, [checkpointId]);
  if (!record)
    return (
      <p role={error ? 'alert' : 'status'}>{error || 'Loading institution…'}</p>
    );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(
      async () =>
        setRecord(
          await apiClient.patch<InstitutionDetail>(base, {
            ...profile(f),
            revision: record!.revision,
          }),
        ),
      'Institution saved.',
    );
  }
  async function addCheckpoint(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      const r = await apiClient.post<{ checkpoint: CheckpointDetail }>(
        '/v1/checkpoints',
        {
          name: value(f, 'name'),
          type: value(f, 'type'),
          cityId: record!.cityId,
          institutionId: id,
          instructions: nullable(f, 'instructions'),
          deliveryCapacity: Number(f.get('capacity')),
          isActive: true,
        },
      );
      await loadCheckpoints();
      setCheckpointId(r.checkpoint.id);
      form.reset();
    }, 'Checkpoint created. Define a delivery window below.');
  }
  async function addWindow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const minute = (key: string) => {
      const [h, m] = value(f, key).split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    await run(async () => {
      await apiClient.post(base + '/checkpoints/' + checkpointId + '/windows', {
        label: value(f, 'label'),
        mealPeriod: value(f, 'mealPeriod'),
        startMinute: minute('start'),
        endMinute: minute('end'),
        orderCutoffMinutes: Number(f.get('cutoff')),
        maxOrders: Number(f.get('capacity')),
      });
      await loadCheckpoint(checkpointId);
    }, 'Delivery window created. The kitchen can now schedule meals for this window.');
  }
  async function requestBulk(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      quantityPerDay: Number(f.get('quantity')),
      mealPeriod: value(f, 'mealPeriod'),
      startDate: value(f, 'startDate'),
      endDate: nullable(f, 'endDate'),
      notes: nullable(f, 'notes'),
    };
    const signature = JSON.stringify(body);
    if (bulkKey.current?.body !== signature)
      bulkKey.current = { body: signature, key: crypto.randomUUID() };
    await run(async () => {
      await apiClient.post(base + '/bulk-requests', {
        ...body,
        idempotencyKey: bulkKey.current!.key,
      });
      setBulk(
        await apiClient.get<Page<InstitutionBulkRequest>>(
          base + '/bulk-requests',
        ),
      );
    }, 'Bulk meal request recorded for Lunch to review.');
  }
  return (
    <div className="space-y-6">
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
      <section className={box}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {record.name} · Delivery statistics
          </h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () =>
                setStats(
                  await apiClient.get<InstitutionStatistics>(
                    base + '/statistics?date=' + date,
                  ),
                ),
              );
            }}
          >
            <input
              aria-label="Delivery date"
              type="date"
              required
              className={field}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              View
            </Button>
          </form>
        </div>
        {stats && (
          <>
            <p className="text-sm text-slate-500">
              Service date · {stats.timezone} · Cancelled meals excluded;
              pending includes unpaid meals.
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                ['Orders', stats.orders],
                ['Meals', stats.meals],
                ['Delivered', stats.deliveredMeals],
                ['Pending', stats.pendingMeals],
                ['Failed', stats.failedMeals],
              ].map(([label, n]) => (
                <div className="rounded-lg bg-slate-50 p-4" key={label}>
                  <p className="text-sm text-slate-600">{label}</p>
                  <p className="text-2xl font-semibold">{n}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {['Checkpoint', 'Window', 'Status', 'Meals', 'Orders'].map(
                      (h) => (
                        <th className="p-2" key={h}>
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {stats.groups.map((g, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{g.checkpoint}</td>
                      <td>{g.timeSlot}</td>
                      <td>{g.status}</td>
                      <td>{g.quantity}</td>
                      <td>{g.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!stats.groups.length && (
                <p className="py-4 text-slate-500">No meals for this date.</p>
              )}
            </div>
          </>
        )}
      </section>
      <details className={box}>
        <summary className="cursor-pointer text-xl font-semibold">
          Profile & institution settings
        </summary>
        <form key={record.revision} onSubmit={save} className="space-y-4">
          <ProfileFields record={record} />
          <p className="text-sm text-slate-500">
            City: {record.city.name}. Registration settings control new account
            registrations; existing child profiles and orders remain available.
          </p>
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              Save profile
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                run(async () =>
                  setRecord(await apiClient.get<InstitutionDetail>(base)),
                )
              }
            >
              Reload profile
            </Button>
          </div>
        </form>
      </details>
      <section className={box}>
        <h2 className="text-xl font-semibold">
          Checkpoints & delivery windows
        </h2>
        <div className="flex flex-wrap gap-2">
          {checkpoints.map((c) => (
            <Button
              key={c.id}
              variant={checkpointId === c.id ? 'primary' : 'secondary'}
              onClick={() => setCheckpointId(c.id)}
            >
              {c.name}
              {!c.isActive ? ' · Inactive' : ''}
            </Button>
          ))}
        </div>
        <div className="flex justify-between">
          <Button
            variant="ghost"
            disabled={checkpointPage === 1 || busy}
            onClick={() => run(() => loadCheckpoints(checkpointPage - 1))}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            disabled={checkpoints.length < 25 || busy}
            onClick={() => run(() => loadCheckpoints(checkpointPage + 1))}
          >
            Next
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer font-medium">
            Add checkpoint
          </summary>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={addCheckpoint}
          >
            <label>
              Name
              <input
                className={field}
                name="name"
                placeholder="Gate A"
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <label>
              Type
              <select className={field} name="type">
                <option value="COLLEGE_GATE">College gate</option>
                <option value="SCHOOL_GATE">School gate</option>
                <option value="HOSTEL">Hostel</option>
                <option value="OFFICE_RECEPTION">Office reception</option>
              </select>
            </label>
            <label>
              Meal capacity per window
              <input
                className={field}
                type="number"
                name="capacity"
                min={1}
                max={100000}
                required
                defaultValue={100}
              />
            </label>
            <label>
              Delivery instructions
              <input className={field} name="instructions" maxLength={1000} />
            </label>
            <Button type="submit" loading={busy}>
              Create checkpoint
            </Button>
          </form>
        </details>
        {checkpoint && (
          <div className="space-y-4 border-t pt-4">
            <div className="flex justify-between">
              <h3 className="font-semibold">{checkpoint.name}</h3>
              <Link
                className="text-emerald-700"
                href={'/admin/checkpoints/' + checkpoint.id + '/edit'}
              >
                Edit checkpoint & windows →
              </Link>
            </div>
            <p className="text-sm">{checkpoint.instructions}</p>
            <ul className="space-y-2">
              {checkpoint.windows.map((w) => (
                <li key={w.id} className="rounded bg-slate-50 p-3">
                  {w.timeSlotLabel} · {w.isActive ? 'Active' : 'Inactive'} ·{' '}
                  {w.maxOrders ?? 'No slot'} meal limit ·{' '}
                  {w.orderCutoffMinutes ?? 'Default'} minute cutoff
                </li>
              ))}
            </ul>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={addWindow}>
              <h4 className="font-medium sm:col-span-2">
                Define a new delivery window
              </h4>
              <label>
                Label
                <input
                  className={field}
                  name="label"
                  placeholder="Gate A — 12:30 PM"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Meal
                <select
                  className={field}
                  name="mealPeriod"
                  defaultValue="LUNCH"
                >
                  {['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Start time
                <input
                  className={field}
                  type="time"
                  name="start"
                  required
                  defaultValue="12:30"
                />
              </label>
              <label>
                End time
                <input
                  className={field}
                  type="time"
                  name="end"
                  required
                  defaultValue="12:40"
                />
              </label>
              <label>
                Order cutoff (minutes before start)
                <input
                  className={field}
                  type="number"
                  name="cutoff"
                  min={0}
                  max={1440}
                  required
                  defaultValue={720}
                />
              </label>
              <label>
                Meal capacity
                <input
                  className={field}
                  type="number"
                  name="capacity"
                  min={1}
                  max={100000}
                  required
                  defaultValue={100}
                />
              </label>
              <Button type="submit" loading={busy}>
                Add delivery window
              </Button>
            </form>
            <p className="text-sm text-slate-500">
              Meal availability also requires kitchen service coverage and a
              scheduled menu for the selected window.
            </p>
          </div>
        )}
      </section>
      <section className={box}>
        <h2 className="text-xl font-semibold">
          Student & customer registrations
        </h2>
        <p className="text-sm text-slate-500">
          Includes self-registered accounts and children linked by their
          parents. These are registrations, not verified enrolment records.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => members());
          }}
        >
          <input
            aria-label="Search registrations"
            className={field}
            placeholder="Name or roll / employee number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            Search
          </Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Name</th>
                <th>Registration</th>
                <th>Identifier</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {registrations?.items.map((m) => (
                <tr className="border-t" key={m.kind + m.id}>
                  <td className="p-2">{m.name}</td>
                  <td>{m.role}</td>
                  <td>{m.identifier ?? '—'}</td>
                  <td>{m.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {registrations && (
          <div className="flex justify-between">
            <Button
              variant="ghost"
              disabled={busy || registrations.page === 1}
              onClick={() => run(() => members(registrations.page - 1))}
            >
              Previous
            </Button>
            <span>{registrations.total} registrations</span>
            <Button
              variant="ghost"
              disabled={busy || registrations.page * 25 >= registrations.total}
              onClick={() => run(() => members(registrations.page + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </section>
      <details className={box}>
        <summary className="cursor-pointer text-xl font-semibold">
          Bulk meal planning
        </summary>
        <p className="text-sm text-slate-600">
          Tell Lunch your expected demand. Requests are non-binding; pricing and
          billing terms require a future agreement.
        </p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={requestBulk}>
          <label>
            Meals per day
            <input
              className={field}
              type="number"
              name="quantity"
              min={1}
              max={100000}
              required
            />
          </label>
          <label>
            Meal
            <select className={field} name="mealPeriod" defaultValue="LUNCH">
              {['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input className={field} type="date" name="startDate" required />
          </label>
          <label>
            End date (optional)
            <input className={field} type="date" name="endDate" />
          </label>
          <label className="sm:col-span-2">
            Requirements
            <textarea
              className={field}
              name="notes"
              maxLength={2000}
              placeholder="Weekdays, dietary needs, proposed budget…"
            />
          </label>
          <Button type="submit" loading={busy}>
            Request bulk plan
          </Button>
        </form>
        <ul className="space-y-2">
          {bulk?.items.map((r) => (
            <li key={r.id} className="rounded bg-slate-50 p-3">
              {r.quantityPerDay} {r.mealPeriod.toLowerCase()} meals/day ·{' '}
              {r.startDate.slice(0, 10)} · {r.status}
            </li>
          ))}
        </ul>
        {bulk && (
          <div className="flex justify-between">
            <Button
              variant="ghost"
              disabled={busy || bulk.page === 1}
              onClick={() =>
                run(async () =>
                  setBulk(
                    await apiClient.get<Page<InstitutionBulkRequest>>(
                      base + '/bulk-requests?page=' + (bulk.page - 1),
                    ),
                  ),
                )
              }
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              disabled={busy || bulk.page * 25 >= bulk.total}
              onClick={() =>
                run(async () =>
                  setBulk(
                    await apiClient.get<Page<InstitutionBulkRequest>>(
                      base + '/bulk-requests?page=' + (bulk.page + 1),
                    ),
                  ),
                )
              }
            >
              Next
            </Button>
          </div>
        )}
      </details>
    </div>
  );
}
