'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ManagedRoute,
  ManagedRouteList,
  RouteOptions,
  RouteCandidate,
  RouteCandidateList,
} from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
const field =
  'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
function message(e: unknown) {
  const error = toFormErrors(e);
  return (
    error.formError ??
    Object.values(error.fields)[0] ??
    'Could not save. Please refresh and try again.'
  );
}
export function RouteSummary({ route }: { route: ManagedRoute }) {
  return (
    <section className="space-y-4 rounded-xl border bg-white p-5">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{route.name}</h2>
          <p className="text-sm text-slate-600">
            {route.date} · {route.kitchen.name} ·{' '}
            {route.partner?.name ?? 'Unassigned'}
          </p>
        </div>
        <span className="text-sm font-medium">
          {route.status.toLowerCase().replaceAll('_', ' ')}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Meals', route.totals.meals],
          ['Orders', route.totals.orders],
          ['Checkpoints', route.totals.checkpoints],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg bg-emerald-50 p-3">
            <p className="text-xl font-semibold">{count}</p>
            <p className="text-xs">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-sm">
        {route.timeSlots.map((s) => s.label).join(' / ')} ·{' '}
        {route.totals.delivered} delivered · {route.totals.failed} failed
      </p>
      <p className="text-sm leading-7">
        <strong>{route.kitchen.name}</strong>
        {route.stops.map((s) => (
          <span key={s.id}> → {s.name}</span>
        ))}
      </p>
    </section>
  );
}
export function RouteList({
  options,
  date: initialDate,
}: {
  options: RouteOptions;
  date: string;
}) {
  const [date, setDate] = useState(initialDate),
    [kitchen, setKitchen] = useState(''),
    [page, setPage] = useState(1);
  const [data, setData] = useState<ManagedRouteList | null>(null),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    apiClient
      .get<ManagedRouteList>(
        '/v1/admin/routes?date=' +
          date +
          '&page=' +
          page +
          (kitchen ? '&kitchenId=' + encodeURIComponent(kitchen) : ''),
      )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [date, kitchen, page, refresh]);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Delivery routes</h1>
          <p className="mt-1 text-slate-600">
            Batch meals by checkpoint and plan the delivery order.
          </p>
        </div>
        <Link
          href="/admin/routes/new"
          className="rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white"
        >
          Plan a route
        </Link>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Delivery date
          <input
            className={field}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-sm">
          Kitchen
          <select
            className={field}
            value={kitchen}
            onChange={(e) => {
              setKitchen(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All kitchens</option>
            {options.kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={() => setRefresh((v) => v + 1)}>
          Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading routes…</p>}
      {data && !data.routes.length && (
        <p className="rounded-xl border p-8 text-slate-600">
          No routes for this date. Plan a route using packed, unassigned meals.
        </p>
      )}
      {data?.routes.map((route) => (
        <div key={route.id} className="space-y-2">
          <RouteSummary route={route} />
          <Link
            className="inline-block px-2 py-2 font-medium text-emerald-700"
            href={'/admin/routes/' + route.id}
          >
            View route & manage batch →
          </Link>
        </div>
      ))}
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
            {data.total} routes · Page {page}
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
export function RouteEditor({
  options,
  date: initialDate,
  route: initialRoute,
}: {
  options: RouteOptions;
  date: string;
  route?: ManagedRoute;
}) {
  const router = useRouter();
  const [route, setRoute] = useState(initialRoute),
    [date, setDate] = useState(initialRoute?.date ?? initialDate),
    [kitchen, setKitchen] = useState(
      initialRoute?.kitchen.id ?? options.kitchens[0]?.id ?? '',
    );
  const [name, setName] = useState(initialRoute?.name ?? ''),
    [partner, setPartner] = useState(initialRoute?.partner?.id ?? ''),
    [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState<RouteCandidateList | null>(null),
    [selected, setSelected] = useState<Record<string, RouteCandidate>>({});
  const [stops, setStops] = useState<{ id: string; name: string }[]>(
    initialRoute?.stops.map((s) => ({ id: s.checkpointId, name: s.name })) ??
      [],
  );
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [refresh, setRefresh] = useState(0);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const city = options.kitchens.find((k) => k.id === kitchen)?.cityId;
  useEffect(() => {
    let active = true;
    setCandidates(null);
    if (!date || !kitchen) return;
    setLoading(true);
    apiClient
      .get<RouteCandidateList>(
        '/v1/admin/routes/candidates?date=' +
          date +
          '&kitchenId=' +
          encodeURIComponent(kitchen) +
          '&page=' +
          page,
      )
      .then((d) => {
        if (active) setCandidates(d);
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, kitchen, page, refresh]);
  function reset() {
    setSelected({});
    setStops([]);
    setPage(1);
    setNotice('');
    setError('');
  }
  function choose(items: RouteCandidate[], checked: boolean) {
    const next = { ...selected };
    for (const i of items) {
      if (checked) next[i.id] = i;
      else delete next[i.id];
    }
    setSelected(next);
    const required = new Map(
      (route?.stops ?? []).map((s) => [
        s.checkpointId,
        { id: s.checkpointId, name: s.name },
      ]),
    );
    for (const i of Object.values(next))
      required.set(i.checkpoint.id, i.checkpoint);
    setStops((old) => [
      ...old.filter((s) => required.has(s.id)),
      ...[...required.values()].filter((s) => !old.some((o) => o.id === s.id)),
    ]);
  }
  function move(index: number, offset: number) {
    setStops((old) => {
      const next = [...old];
      [next[index], next[index + offset]] = [
        next[index + offset]!,
        next[index]!,
      ];
      return next;
    });
  }
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    const common = {
      name,
      deliveryPartnerId: partner,
      checkpointIds: stops.map((s) => s.id),
      orderItemIds: Object.keys(selected),
    };
    try {
      let result: { route: ManagedRoute };
      if (route)
        result = await apiClient.patch('/v1/admin/routes/' + route.id, {
          ...common,
          revision: route.revision,
        });
      else {
        const body = { ...common, date, kitchenId: kitchen };
        const signature = JSON.stringify(body);
        if (request.current?.signature !== signature)
          request.current = { signature, key: crypto.randomUUID() };
        result = await apiClient.post('/v1/admin/routes', {
          ...body,
          idempotencyKey: request.current.key,
        });
      }
      if (!route) {
        router.push('/admin/routes/' + result.route.id);
        router.refresh();
      } else {
        setRoute(result.route);
        setSelected({});
        setStops(
          result.route.stops.map((s) => ({ id: s.checkpointId, name: s.name })),
        );
        setNotice(
          'Route saved. Partner assignments and checkpoint order are updated.',
        );
        setRefresh((v) => v + 1);
        router.refresh();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const groups = new Map<string, RouteCandidate[]>();
  for (const item of candidates?.items ?? [])
    groups.set(item.checkpoint.id, [
      ...(groups.get(item.checkpoint.id) ?? []),
      item,
    ]);
  const chosen = Object.values(selected);
  const frozen = route && !route.editable;
  return (
    <div className="space-y-6">
      {frozen && (
        <p className="rounded-lg bg-amber-50 p-4">
          This route has progressed. Its assignment and checkpoint order are
          locked.
        </p>
      )}
      {!frozen && (
        <>
          <h2 className="text-xl font-semibold">
            {route ? 'Edit assignment & batch' : 'Plan a delivery route'}
          </h2>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-emerald-700">
              {notice}
            </p>
          )}
          <fieldset disabled={busy} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                Route name
                <input
                  className={field}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="College lunch route"
                />
              </label>
              <label className="text-sm">
                Delivery date
                <input
                  className={field}
                  type="date"
                  value={date}
                  disabled={!!route}
                  onChange={(e) => {
                    reset();
                    setDate(e.target.value);
                  }}
                />
              </label>
              <label className="text-sm">
                Kitchen
                <select
                  className={field}
                  disabled={!!route}
                  value={kitchen}
                  onChange={(e) => {
                    reset();
                    setKitchen(e.target.value);
                    setPartner('');
                  }}
                >
                  <option value="">Choose kitchen</option>
                  {options.kitchens.map((k) => (
                    <option value={k.id} key={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Delivery partner
                <select
                  className={field}
                  value={partner}
                  onChange={(e) => setPartner(e.target.value)}
                >
                  <option value="">Choose partner</option>
                  {options.partners
                    .filter(
                      (p) => !p.cityId || p.cityId === city || p.id === partner,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.isAvailable}>
                        {p.name}
                        {p.isAvailable ? '' : ' · unavailable'}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <section className="space-y-3">
              <h3 className="font-semibold">
                {route ? 'Add packed meals (optional)' : 'Choose packed meals'}
              </h3>
              <p className="text-sm text-slate-500">
                Select a checkpoint batch or individual meals. Only packed,
                unassigned items appear. Each route supports up to 500
                deliveries.
              </p>
              {loading && <p role="status">Loading packed meals…</p>}
              {candidates && !candidates.items.length && (
                <p className="rounded-lg bg-slate-50 p-4">
                  No packed, unassigned meals for this kitchen and date.
                </p>
              )}
              {[...groups.values()].map((items) => (
                <div
                  className="rounded-lg border p-4"
                  key={items[0]!.checkpoint.id}
                >
                  <label className="flex items-center gap-3 py-2 font-semibold">
                    <input
                      className="h-5 w-5"
                      type="checkbox"
                      checked={items.every((i) => !!selected[i.id])}
                      onChange={(e) => choose(items, e.target.checked)}
                    />
                    {items[0]!.checkpoint.name} ·{' '}
                    {items.reduce((n, i) => n + i.quantity, 0)} meals on this
                    page
                  </label>
                  {items.map((i) => (
                    <label
                      key={i.id}
                      className="flex items-start gap-3 border-t py-3 text-sm"
                    >
                      <input
                        className="mt-1 h-5 w-5"
                        type="checkbox"
                        checked={!!selected[i.id]}
                        onChange={(e) => choose([i], e.target.checked)}
                      />
                      <span>
                        {i.quantity} × {i.mealName}
                        <span className="block text-slate-500">
                          {i.timeSlot.label} · {i.orderNumber}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              {candidates && (
                <nav className="flex items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    disabled={page === 1 || loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    {candidates.total} eligible deliveries · Page {page}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={
                      page * candidates.pageSize >= candidates.total || loading
                    }
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </nav>
              )}
              <p className="text-sm font-medium">
                {chosen.reduce((n, i) => n + i.quantity, 0)} new meals ·{' '}
                {new Set(chosen.map((i) => i.orderId)).size} orders in selection
                · {chosen.length} selected deliveries
              </p>
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Checkpoint order</h3>
              <p className="text-sm text-slate-600">
                Start:{' '}
                {options.kitchens.find((k) => k.id === kitchen)?.name ??
                  'Choose a kitchen'}
                . Move checkpoints into the intended delivery order.
              </p>
              {!stops.length && (
                <p className="text-sm text-slate-500">
                  Select meals to add their checkpoints.
                </p>
              )}
              <ol className="divide-y rounded-lg border px-4">
                {stops.map((s, index) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span>
                      {index + 1}. {s.name}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        aria-label={'Move ' + s.name + ' earlier'}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={'Move ' + s.name + ' later'}
                        disabled={index === stops.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <Button
              loading={busy}
              disabled={
                !name.trim() ||
                !partner ||
                !stops.length ||
                chosen.length > 500 ||
                (!route && !chosen.length)
              }
              onClick={save}
            >
              {route ? 'Save route' : 'Create & assign route'}
            </Button>
          </fieldset>
        </>
      )}
    </div>
  );
}
