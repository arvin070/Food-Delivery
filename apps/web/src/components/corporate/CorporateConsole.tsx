'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type {
  CorporateSummary,
  CorporateDetail,
  CorporateEmployee,
  CorporateUsage,
  CorporateOrderRow,
  CorporateInvoiceRow,
} from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
type Office = {
  id: string;
  name: string;
  instructions: string | null;
  deliveryCapacity: number | null;
  isActive: boolean;
  timeSlots: {
    timeSlot: {
      id: string;
      label: string;
      startMinute: number;
      endMinute: number;
    };
  }[];
};
type Offer = {
  id: string;
  price: string;
  totalQuantity: number;
  reservedQuantity: number;
  meal: { name: string };
  timeSlot: { label: string; mealPeriod: string };
  kitchen: { name: string };
};
const field =
  'mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5';
const box = 'space-y-4 rounded-xl border bg-white p-5';
const errorText = (e: unknown) =>
  toFormErrors(e).formError ?? 'Could not complete this request.';
const value = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const money = (amount: string) =>
  '₹' +
  Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const periods = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'];
function Pager({
  data,
  busy,
  onPage,
}: {
  data: { page: number; total: number; pageSize: number };
  busy: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="flex items-center justify-between gap-3">
      <Button
        variant="ghost"
        disabled={busy || data.page === 1}
        onClick={() => onPage(data.page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-slate-500">{data.total} records</span>
      <Button
        variant="ghost"
        disabled={busy || data.page * data.pageSize >= data.total}
        onClick={() => onPage(data.page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
export function CorporateConsole({
  initial,
  superAdmin,
}: {
  initial: Page<CorporateSummary>;
  superAdmin: boolean;
}) {
  const [data, setData] = useState(initial),
    [selected, setSelected] = useState(initial.items[0]?.id ?? ''),
    [search, setSearch] = useState(''),
    [cities, setCities] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    apiClient
      .get<{ cities: { id: string; name: string }[] }>('/v1/reference/cities')
      .then((r) => setCities(r.cities))
      .catch((e) => setError(errorText(e)));
  }, []);
  async function load(page = 1) {
    try {
      setData(
        await apiClient.get<Page<CorporateSummary>>(
          '/v1/corporate?' +
            new URLSearchParams({ search, page: String(page) }),
        ),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const r = await apiClient.post<{ id: string }>('/v1/corporate', {
        name: value(f, 'name'),
        cityId: value(f, 'cityId'),
        billingEmail: value(f, 'billingEmail'),
      });
      setSelected(r.id);
      await load();
      form.reset();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Corporate meals</h1>
        <p className="mt-2 text-slate-600">
          Company meal benefits, office deliveries and monthly billing.
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
            aria-label="Search companies"
            className={field}
            placeholder="Search your companies"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {data.items.map((c) => (
            <Button
              key={c.id}
              variant={c.id === selected ? 'primary' : 'secondary'}
              onClick={() => setSelected(c.id)}
            >
              {c.name} · {c.role.toLowerCase()}
            </Button>
          ))}
        </div>
        {!data.total && (
          <p>
            No companies linked yet. Create your company or ask its
            administrator to add your existing Lunch account.
          </p>
        )}
        <Pager data={data} busy={busy} onPage={load} />
      </section>
      <details className={box}>
        <summary className="cursor-pointer font-semibold">
          Create a corporate account
        </summary>
        <p className="text-sm text-slate-600">
          You become the company administrator. You can configure employees and
          policy immediately; company-funded ordering starts after Lunch
          approves a credit limit.
        </p>
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
          <label>
            Company name
            <input
              className={field}
              name="name"
              required
              minLength={2}
              maxLength={160}
            />
          </label>
          <label>
            Billing email
            <input
              className={field}
              type="email"
              name="billingEmail"
              required
            />
          </label>
          <label>
            Office city
            <select className={field} name="cityId" required>
              <option value="">Choose city</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="self-end">
            <Button type="submit" loading={busy}>
              Create company
            </Button>
          </div>
        </form>
      </details>
      {selected && (
        <CompanyWorkspace
          key={selected}
          id={selected}
          superAdmin={superAdmin}
        />
      )}
    </div>
  );
}
function CompanyWorkspace({
  id,
  superAdmin,
}: {
  id: string;
  superAdmin: boolean;
}) {
  const base = '/v1/corporate/' + id;
  const [company, setCompany] = useState<CorporateDetail | null>(null),
    [usage, setUsage] = useState<CorporateUsage | null>(null),
    [employees, setEmployees] = useState<Page<CorporateEmployee> | null>(null),
    [orders, setOrders] = useState<Page<CorporateOrderRow> | null>(null),
    [invoices, setInvoices] = useState<Page<CorporateInvoiceRow> | null>(null),
    [offices, setOffices] = useState<Office[]>([]),
    [slots, setSlots] = useState<{ id: string; label: string }[]>([]);
  const [month, setMonth] = useState(''),
    [employeeSearch, setEmployeeSearch] = useState(''),
    [date, setDate] = useState(''),
    [officeId, setOfficeId] = useState(''),
    [offers, setOffers] = useState<Page<Offer> | null>(null),
    [offerId, setOfferId] = useState(''),
    [bulk, setBulk] = useState(false),
    [selectedEmployees, setSelectedEmployees] = useState<string[]>([]),
    [quantity, setQuantity] = useState(1),
    [maxCopay, setMaxCopay] = useState('0');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const requestKey = useRef<{ body: string; key: string } | null>(null);
  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (success) setNotice(success);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function loadEmployees(page = 1) {
    setEmployees(
      await apiClient.get<Page<CorporateEmployee>>(
        base +
          '/employees?' +
          new URLSearchParams({ search: employeeSearch, page: String(page) }),
      ),
    );
  }
  async function loadOrders(page = 1) {
    setOrders(
      await apiClient.get<Page<CorporateOrderRow>>(
        base + '/orders?' + new URLSearchParams({ month, page: String(page) }),
      ),
    );
  }
  async function loadInvoices(page = 1) {
    setInvoices(
      await apiClient.get<Page<CorporateInvoiceRow>>(
        base + '/invoices?page=' + page,
      ),
    );
  }
  async function refresh() {
    const [c, u] = await Promise.all([
      apiClient.get<CorporateDetail>(base),
      apiClient.get<CorporateUsage>(
        base + '/usage' + (month ? '?month=' + month : ''),
      ),
    ]);
    setCompany(c);
    setUsage(u);
    await loadOrders();
  }
  useEffect(() => {
    let live = true;
    (async () => {
      const [c, u, o, cp] = await Promise.all([
        apiClient.get<CorporateDetail>(base),
        apiClient.get<CorporateUsage>(base + '/usage'),
        apiClient.get<Page<CorporateOrderRow>>(base + '/orders'),
        apiClient.get<Office[]>(base + '/offices'),
      ]);
      if (!live) return;
      setCompany(c);
      setUsage(u);
      setMonth(u.month);
      setOrders(o);
      setOffices(cp);
      setOfficeId(cp.find((x) => x.isActive)?.id ?? '');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setDate(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: c.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(tomorrow),
      );
      if (c.role === 'ADMIN') {
        const [e, i, t] = await Promise.all([
          apiClient.get<Page<CorporateEmployee>>(base + '/employees'),
          apiClient.get<Page<CorporateInvoiceRow>>(base + '/invoices'),
          apiClient.get<{ timeSlots: { id: string; label: string }[] }>(
            '/v1/reference/time-slots?cityId=' + c.cityId,
          ),
        ]);
        if (live) {
          setEmployees(e);
          setInvoices(i);
          setSlots(t.timeSlots);
        }
      }
    })().catch((e) => {
      if (live) setError(errorText(e));
    });
    return () => {
      live = false;
    };
  }, [base]);
  async function loadOffers(page = 1) {
    setOfferId('');
    setOffers(
      await apiClient.get<Page<Offer>>(
        base +
          '/offers?' +
          new URLSearchParams({
            date,
            checkpointId: officeId,
            page: String(page),
          }),
      ),
    );
  }
  if (!company)
    return (
      <p role={error ? 'alert' : 'status'}>
        {error || 'Loading corporate account…'}
      </p>
    );
  const isAdmin = company.role === 'ADMIN';
  async function savePolicy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      await apiClient.patch(base + '/policy', {
        revision: company!.revision,
        monthlyBudget: value(f, 'monthlyBudget'),
        employeeMonthlyCredit: value(f, 'employeeMonthlyCredit'),
        subsidyPerMeal: value(f, 'subsidyPerMeal'),
        maxMealsPerDay: Number(f.get('maxMealsPerDay')),
        allowedWeekdays: f.getAll('days').map(Number),
        allowedPeriods: f.getAll('periods'),
        allowCopayment: f.get('allowCopayment') === 'on',
        billingEmail: value(f, 'billingEmail'),
      });
      await refresh();
    }, 'Meal policy saved. Existing authorizations keep their original terms.');
  }
  async function addEmployee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      await apiClient.post(base + '/employees', {
        email: value(f, 'email'),
        employeeNumber: value(f, 'employeeNumber') || null,
        monthlyCredit: value(f, 'monthlyCredit') || null,
        role: value(f, 'role'),
      });
      await loadEmployees();
      form.reset();
    }, 'Employee added. Their existing consumer account remains unchanged.');
  }
  async function addOffice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      await apiClient.post(base + '/offices', {
        name: value(f, 'name'),
        instructions: value(f, 'instructions') || null,
        deliveryCapacity: Number(f.get('capacity')),
        timeSlotIds: f.getAll('slots'),
      });
      const rows = await apiClient.get<Office[]>(base + '/offices');
      setOffices(rows);
      setOfficeId(rows[0]?.id ?? '');
      form.reset();
    }, 'Office checkpoint created. A kitchen must serve it and publish meals for its windows.');
  }
  async function placeOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ids = bulk
      ? selectedEmployees
      : company!.memberId
        ? [company!.memberId]
        : [];
    const body = {
      maxEmployeeAmount: bulk ? '0' : maxCopay,
      lines: ids.map((memberId) => ({
        memberId,
        mealScheduleId: offerId,
        checkpointId: officeId,
        quantity,
      })),
    };
    const signature = JSON.stringify(body);
    if (requestKey.current?.body !== signature)
      requestKey.current = { body: signature, key: crypto.randomUUID() };
    await run(async () => {
      const result = await apiClient.post<{ orders: CorporateOrderRow[] }>(
        base + '/orders',
        { ...body, idempotencyKey: requestKey.current!.key },
      );
      await refresh();
      setOffers(null);
      setOfferId('');
      setSelectedEmployees([]);
      setNotice(
        `${result.orders.length} order(s) created. Any employee co-payment must be verified before confirmation.`,
      );
    });
  }
  const currentOffer = offers?.items.find((o) => o.id === offerId);
  const expectedCopay = currentOffer
    ? Math.max(0, Number(currentOffer.price) - Number(company.subsidyPerMeal)) *
      quantity
    : 0;
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
          <div>
            <h2 className="text-2xl font-semibold">{company.name}</h2>
            <p className="text-sm text-slate-500">
              {company.status} · {company.timezone} · {company.currency}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(refresh)}
          >
            Refresh account
          </Button>
        </div>
        {company.status !== 'ACTIVE' && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm">
            Company-funded ordering is unavailable until Lunch approves and
            activates company credit.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setUsage(
                await apiClient.get<CorporateUsage>(
                  base + '/usage?month=' + month,
                ),
              );
              await loadOrders();
            });
          }}
        >
          <label>
            Usage month
            <input
              className={field}
              type="month"
              required
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            View usage
          </Button>
        </form>
        {usage && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Meals / orders', `${usage.meals} / ${usage.orders}`],
              ['Company contribution', money(usage.companyAmount)],
              ['Employee co-payments', money(usage.employeeAmount)],
              ['Your remaining credits', money(usage.remainingCredit)],
              ...(isAdmin
                ? [
                    [
                      'Remaining company budget',
                      money(usage.remainingBudget ?? '0'),
                    ],
                    [
                      'Outstanding company credit',
                      money(usage.outstanding ?? '0'),
                    ],
                    [
                      'Approved credit limit',
                      money(company.creditLimit ?? '0'),
                    ],
                  ]
                : []),
            ].map(([label, n]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">{label}</p>
                <p className="mt-1 text-xl font-semibold">{n}</p>
              </div>
            ))}
          </div>
        )}
        <p className="text-sm text-slate-500">
          Credits are monthly company-funded allowances, not cash balances.
          Usage includes reserved orders; cancellations restore credits.
          Personal meal orders use your normal cart.
        </p>
      </section>
      {superAdmin && (
        <details className={box}>
          <summary className="cursor-pointer font-semibold">
            Platform credit approval
          </summary>
          <p className="text-sm text-slate-600">
            Approve a company credit limit after reviewing its billing
            arrangements. This allows company-funded orders before monthly
            settlement.
          </p>
          <form
            key={company.revision}
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await apiClient.post(base + '/credit', {
                  revision: company.revision,
                  status: value(f, 'status'),
                  creditLimit: value(f, 'creditLimit'),
                  reason: value(f, 'reason'),
                });
                await refresh();
              }, 'Company credit decision recorded.');
            }}
          >
            <label>
              Status
              <select
                name="status"
                className={field}
                defaultValue={
                  company.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'
                }
              >
                <option>ACTIVE</option>
                <option>SUSPENDED</option>
              </select>
            </label>
            <label>
              Credit limit (INR)
              <input
                name="creditLimit"
                className={field}
                type="number"
                min="0"
                max="99999999"
                step="0.01"
                required
                defaultValue={company.creditLimit}
              />
            </label>
            <label className="sm:col-span-2">
              Decision reason
              <input
                className={field}
                name="reason"
                required
                minLength={3}
                maxLength={500}
              />
            </label>
            <Button type="submit" loading={busy}>
              Record credit decision
            </Button>
          </form>
        </details>
      )}
      {isAdmin && (
        <details className={box}>
          <summary className="cursor-pointer text-xl font-semibold">
            Meal policy & budgets
          </summary>
          <form
            key={company.revision}
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={savePolicy}
          >
            {[
              [
                'monthlyBudget',
                'Company monthly budget',
                company.monthlyBudget,
              ],
              [
                'employeeMonthlyCredit',
                'Default employee monthly credits',
                company.employeeMonthlyCredit,
              ],
              [
                'subsidyPerMeal',
                'Company subsidy per meal',
                company.subsidyPerMeal,
              ],
            ].map(([name, label, v]) => (
              <label key={name}>
                {label} (INR)
                <input
                  className={field}
                  name={name}
                  type="number"
                  step="0.01"
                  min="0"
                  max="99999999"
                  required
                  defaultValue={v}
                />
              </label>
            ))}
            <label>
              Meals per employee per day
              <input
                className={field}
                name="maxMealsPerDay"
                type="number"
                min={1}
                max={10}
                required
                defaultValue={company.maxMealsPerDay}
              />
            </label>
            <label>
              Billing email
              <input
                className={field}
                name="billingEmail"
                type="email"
                required
                defaultValue={company.billingEmail}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                name="allowCopayment"
                type="checkbox"
                defaultChecked={company.allowCopayment}
              />
              Allow employee co-payment
            </label>
            <fieldset>
              <legend className="font-medium">Eligible days</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                  (d, i) => (
                    <label className="flex items-center gap-1" key={d}>
                      <input
                        type="checkbox"
                        name="days"
                        value={i}
                        defaultChecked={company.allowedWeekdays.includes(i)}
                      />
                      {d}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <fieldset>
              <legend className="font-medium">Eligible meals</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {periods.map((p) => (
                  <label className="flex items-center gap-1" key={p}>
                    <input
                      name="periods"
                      type="checkbox"
                      value={p}
                      defaultChecked={company.allowedPeriods.includes(p)}
                    />
                    {p.toLowerCase()}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-sm text-slate-500 sm:col-span-2">
              Subsidies cannot exceed employee credits, the monthly company
              budget or approved outstanding credit. New settings apply to
              future authorizations. Bulk orders must cover the entire meal
              price.
            </p>
            <Button type="submit" loading={busy}>
              Save policy
            </Button>
          </form>
        </details>
      )}
      {isAdmin && (
        <details className={box}>
          <summary className="cursor-pointer text-xl font-semibold">
            Employees & meal credits
          </summary>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={addEmployee}>
            <label>
              Existing Lunch account email
              <input className={field} name="email" type="email" required />
            </label>
            <label>
              Employee number
              <input className={field} name="employeeNumber" maxLength={100} />
            </label>
            <label>
              Monthly credit override (INR)
              <input
                className={field}
                name="monthlyCredit"
                type="number"
                min="0"
                max="99999999"
                step="0.01"
                placeholder="Use company default"
              />
            </label>
            <label>
              Company role
              <select className={field} name="role">
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Corporate admin</option>
              </select>
            </label>
            <Button type="submit" loading={busy}>
              Add employee
            </Button>
          </form>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => loadEmployees());
            }}
          >
            <input
              aria-label="Search employees"
              className={field}
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              placeholder="Search employee name or email"
            />
            <Button type="submit" disabled={busy}>
              Search
            </Button>
          </form>
          <div className="space-y-2">
            {employees?.items.map((e) => (
              <details key={e.id} className="rounded-lg border p-3">
                <summary className="cursor-pointer">
                  {e.user.fullName} · {e.employeeNumber ?? e.user.email} ·{' '}
                  {e.isActive ? 'Active' : 'Inactive'} · {e.role.toLowerCase()}
                </summary>
                <form
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const f = new FormData(event.currentTarget);
                    void run(async () => {
                      await apiClient.patch(base + '/employees/' + e.id, {
                        isActive: f.get('isActive') === 'on',
                        monthlyCredit: value(f, 'monthlyCredit') || null,
                        reason: value(f, 'reason'),
                      });
                      await loadEmployees(employees!.page);
                      await refresh();
                    }, 'Employee benefits updated.');
                  }}
                >
                  <label>
                    Monthly credit override
                    <input
                      className={field}
                      name="monthlyCredit"
                      type="number"
                      min="0"
                      step="0.01"
                      max="99999999"
                      defaultValue={e.monthlyCredit ?? ''}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      name="isActive"
                      type="checkbox"
                      defaultChecked={e.isActive}
                    />
                    Active membership
                  </label>
                  <label>
                    Reason
                    <input
                      className={field}
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                    />
                  </label>
                  <Button type="submit" loading={busy}>
                    Update employee
                  </Button>
                </form>
              </details>
            ))}
          </div>
          {employees && (
            <Pager
              data={employees}
              busy={busy}
              onPage={(page) => run(() => loadEmployees(page))}
            />
          )}
        </details>
      )}
      <section className={box}>
        <h2 className="text-xl font-semibold">Office checkpoints</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {offices.map((o) => (
            <div key={o.id} className="rounded-lg bg-slate-50 p-4">
              <h3 className="font-medium">{o.name}</h3>
              <p className="text-sm">{o.instructions}</p>
              <p className="mt-2 text-sm text-slate-500">
                {o.timeSlots.map((t) => t.timeSlot.label).join(' · ') ||
                  'No active windows'}{' '}
                · Capacity {o.deliveryCapacity ?? 'not set'}
              </p>
            </div>
          ))}
        </div>
        {!offices.length && (
          <p className="text-slate-500">No office checkpoints yet.</p>
        )}
        {isAdmin && (
          <details>
            <summary className="cursor-pointer font-medium">
              Create office checkpoint
            </summary>
            <form
              onSubmit={addOffice}
              className="mt-3 grid gap-3 sm:grid-cols-2"
            >
              <label>
                Office / reception name
                <input
                  name="name"
                  className={field}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label>
                Meal capacity per window
                <input
                  name="capacity"
                  className={field}
                  type="number"
                  min={1}
                  max={100000}
                  required
                  defaultValue={100}
                />
              </label>
              <label className="sm:col-span-2">
                Delivery instructions
                <input name="instructions" className={field} maxLength={1000} />
              </label>
              <fieldset className="sm:col-span-2">
                <legend className="font-medium">Delivery windows</legend>
                <div className="mt-2 flex max-h-48 flex-wrap gap-3 overflow-y-auto">
                  {slots.map((s) => (
                    <label className="flex items-center gap-2" key={s.id}>
                      <input type="checkbox" name="slots" value={s.id} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" loading={busy}>
                Create checkpoint
              </Button>
            </form>
            <p className="mt-3 text-sm text-slate-500">
              Lunch must connect a kitchen to a new office checkpoint before
              meals appear.
            </p>
          </details>
        )}
      </section>
      <section className={box}>
        <h2 className="text-xl font-semibold">Order company meals</h2>
        <p className="text-sm text-slate-600">
          Company subsidy: {money(company.subsidyPerMeal)} per meal · Up to{' '}
          {company.maxMealsPerDay} meals per employee per day.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => loadOffers());
          }}
        >
          <label>
            Delivery date
            <input
              className={field}
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setOffers(null);
                setOfferId('');
              }}
            />
          </label>
          <label>
            Office checkpoint
            <select
              className={field}
              required
              value={officeId}
              onChange={(e) => {
                setOfficeId(e.target.value);
                setOffers(null);
                setOfferId('');
              }}
            >
              <option value="">Select office</option>
              {offices
                .filter((o) => o.isActive)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="self-end">
            <Button
              type="submit"
              disabled={busy || company.status !== 'ACTIVE'}
            >
              Find meals
            </Button>
          </div>
        </form>
        {offers && (
          <>
            <form onSubmit={placeOrder} className="space-y-4">
              <label className="block">
                Meal
                <select
                  className={field}
                  required
                  value={offerId}
                  onChange={(e) => setOfferId(e.target.value)}
                >
                  <option value="">Select a meal</option>
                  {offers.items.map((o) => (
                    <option value={o.id} key={o.id}>
                      {o.meal.name} · {o.kitchen.name} · {o.timeSlot.label} ·{' '}
                      {money(o.price)} · {o.totalQuantity - o.reservedQuantity}{' '}
                      left
                    </option>
                  ))}
                </select>
              </label>
              {!offers.items.length && (
                <p className="text-sm text-slate-500">
                  No published meals for this office and date.
                </p>
              )}
              {isAdmin && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={bulk}
                    onChange={(e) => setBulk(e.target.checked)}
                  />
                  Book fully company-funded meals for employees
                </label>
              )}
              {bulk && isAdmin && (
                <fieldset>
                  <legend className="font-medium">
                    Employees — select up to 50 ({selectedEmployees.length}{' '}
                    selected)
                  </legend>
                  <p className="text-sm text-slate-500">
                    Use employee search and pagination above to load more
                    employees. Selections persist across pages.
                  </p>
                  <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                    {employees?.items
                      .filter((e) => e.isActive)
                      .map((e) => (
                        <label
                          key={e.id}
                          className="flex items-center gap-2 rounded border p-2"
                        >
                          <input
                            type="checkbox"
                            checked={selectedEmployees.includes(e.id)}
                            onChange={(v) =>
                              setSelectedEmployees((previous) =>
                                v.target.checked
                                  ? [...previous, e.id]
                                  : previous.filter((x) => x !== e.id),
                              )
                            }
                          />
                          {e.user.fullName}
                        </label>
                      ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSelectedEmployees([])}
                  >
                    Clear selection
                  </Button>
                </fieldset>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  Quantity per employee
                  <input
                    className={field}
                    type="number"
                    min={1}
                    max={company.maxMealsPerDay}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </label>
                {!bulk && (
                  <label>
                    Maximum co-payment you authorize (INR)
                    <input
                      className={field}
                      type="number"
                      min="0"
                      step="0.01"
                      max="99999999"
                      required
                      value={maxCopay}
                      onChange={(e) => setMaxCopay(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {currentOffer && (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm">
                  Meal total per employee:{' '}
                  {money(String(Number(currentOffer.price) * quantity))} ·
                  Expected company contribution:{' '}
                  {money(
                    String(
                      Math.min(
                        Number(currentOffer.price),
                        Number(company.subsidyPerMeal),
                      ) * quantity,
                    ),
                  )}{' '}
                  · Employee co-payment: {money(String(expectedCopay))}. Final
                  eligibility and capacity are checked when ordering.
                </p>
              )}
              <Button
                type="submit"
                loading={busy}
                disabled={
                  !offerId ||
                  company.status !== 'ACTIVE' ||
                  (bulk
                    ? selectedEmployees.length === 0 ||
                      selectedEmployees.length > 50
                    : !company.memberId)
                }
              >
                {bulk
                  ? 'Place company-funded bulk order'
                  : 'Place my meal order'}
              </Button>
            </form>
            <Pager
              data={offers}
              busy={busy}
              onPage={(page) => run(() => loadOffers(page))}
            />
          </>
        )}
      </section>
      <section className={box}>
        <h2 className="text-xl font-semibold">
          {isAdmin ? 'Company orders' : 'Your company orders'}
        </h2>
        {orders?.items.map((o) => (
          <article key={o.id} className="space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-medium">
                {o.order.items[0]?.beneficiaryName} · {o.quantity} ×{' '}
                {o.order.items[0]?.mealNameSnapshot}
              </p>
              <span className="text-sm">
                {o.order.items[0]?.status ?? o.order.status}
              </span>
            </div>
            <p className="text-sm text-slate-600">
              {o.serviceDate.slice(0, 10)} · {o.order.items[0]?.checkpoint.name}{' '}
              · {o.order.orderNumber}
            </p>
            <p className="text-sm">
              Company {money(o.companyAmount)} · Employee{' '}
              {money(o.employeeAmount)} · {o.status.toLowerCase()}
            </p>
            <div className="flex flex-wrap gap-3">
              {o.memberId === company.memberId && (
                <Link
                  className="py-2 text-emerald-700"
                  href={'/orders/' + o.orderId}
                >
                  View order / pay co-payment →
                </Link>
              )}
              {o.status === 'AUTHORIZED' &&
                o.order.items.every((i) =>
                  ['PENDING', 'CONFIRMED'].includes(i.status),
                ) && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await apiClient.post(
                          base + '/orders/' + o.orderId + '/cancel',
                        );
                        await refresh();
                      }, 'Order cancelled. Company credits released; any captured employee payment can be refunded from payment history.')
                    }
                  >
                    Cancel order
                  </Button>
                )}
            </div>
          </article>
        ))}
        {orders && !orders.items.length && (
          <p className="text-slate-500">No corporate orders in this view.</p>
        )}
        {orders && (
          <Pager
            data={orders}
            busy={busy}
            onPage={(page) => run(() => loadOrders(page))}
          />
        )}
      </section>
      {isAdmin && (
        <section className={box}>
          <h2 className="text-xl font-semibold">Monthly billing</h2>
          <p className="text-sm text-slate-600">
            Invoices cover company contributions only. Employee co-payments
            remain separate. Delivered meals and prepared meals with failed
            delivery are billable; cancelled meals are excluded.
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await apiClient.post(base + '/invoices', {
                  month: value(f, 'month'),
                });
                await loadInvoices();
                await refresh();
              }, 'Monthly invoice issued.');
            }}
          >
            <label>
              Completed service month
              <input type="month" name="month" className={field} required />
            </label>
            <Button type="submit" loading={busy}>
              Issue monthly invoice
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await apiClient.post<{ expired: number }>(
                    base + '/expire',
                  );
                  await refresh();
                  setNotice(
                    `${r.expired} unpaid past orders expired. Each run processes up to 50.`,
                  );
                })
              }
            >
              Expire past unpaid orders
            </Button>
          </form>
          {invoices?.items.map((i) => (
            <details key={i.id} className="rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                {i.month} · {money(i.amount)} ·{' '}
                {i.settledAt ? 'Settled' : 'Outstanding'}
              </summary>
              <div className="mt-3 space-y-2 text-sm">
                <p>Invoice: {i.number}</p>
                <p>Company: {String(i.snapshot.companyName ?? company.name)}</p>
                <p>Billing email: {String(i.snapshot.billingEmail ?? '')}</p>
                <p>
                  {String(i.snapshot.meals ?? 0)} meals ·{' '}
                  {String(i.snapshot.orders ?? 0)} orders · {i.currency}
                </p>
                <p>{String(i.snapshot.terms ?? '')}</p>
                <p>Issued: {new Date(i.issuedAt).toLocaleDateString()}</p>
                {i.settlementReference && (
                  <p>Settlement reference: {i.settlementReference}</p>
                )}
                <Button variant="secondary" onClick={() => window.print()}>
                  Print billing record
                </Button>
                {superAdmin && !i.settledAt && (
                  <form
                    className="grid gap-3 border-t pt-3 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        await apiClient.post(
                          base + '/invoices/' + i.id + '/settle',
                          {
                            amount: i.amount,
                            reference: value(f, 'reference'),
                            reason: value(f, 'reason'),
                          },
                        );
                        await loadInvoices(invoices.page);
                        await refresh();
                      }, 'Verified bank settlement recorded.');
                    }}
                  >
                    <p className="sm:col-span-2 font-medium">
                      Platform finance: record a verified full bank settlement
                      of {money(i.amount)}.
                    </p>
                    <label>
                      Unique bank reference
                      <input
                        name="reference"
                        className={field}
                        required
                        minLength={4}
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Verification note
                      <input
                        name="reason"
                        className={field}
                        required
                        minLength={3}
                        maxLength={500}
                      />
                    </label>
                    <Button type="submit" loading={busy}>
                      Record verified settlement
                    </Button>
                  </form>
                )}
              </div>
            </details>
          ))}
          {invoices && (
            <Pager
              data={invoices}
              busy={busy}
              onPage={(page) => run(() => loadInvoices(page))}
            />
          )}
        </section>
      )}
    </div>
  );
}
