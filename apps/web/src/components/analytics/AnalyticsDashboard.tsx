"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { analyticsQuerySchema, type AnalyticsReport } from "@lunch/shared";
import { apiClient } from "@/lib/api.client";
import { Button } from "@/components/ui/Button";
import { toFormErrors } from "@/lib/form";
const box = "rounded-xl border border-slate-200 bg-white p-5";
const field =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5";
const percent = (n: number | null) => (n === null ? "—" : n.toFixed(1) + "%");
const amount = (n: string, currency: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(n));
function TrendChart({
  title,
  rows,
  unit = "orders",
  second = false,
}: {
  title: string;
  rows: { date: string; value: number; other?: number }[];
  unit?: string;
  second?: boolean;
}) {
  const values = rows.flatMap((r) => [r.value, r.other ?? 0]);
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min;
  const x = (i: number) => 48 + (i * 704) / Math.max(1, rows.length - 1),
    y = (v: number) => 194 - ((v - min) / span) * 156;
  const line = (key: "value" | "other") =>
    rows
      .map(
        (r, i) =>
          (i ? "L" : "M") + x(i).toFixed(2) + "," + y(r[key] ?? 0).toFixed(2),
      )
      .join(" ");
  return (
    <section className={box}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">
        {unit}
        {second
          ? " · Green: total orders · Orange: cancelled/refunded orders"
          : ""}
      </p>
      <svg
        viewBox="0 0 800 238"
        className="mt-3 w-full"
        role="img"
        aria-label={
          title + " from " + rows[0]?.date + " to " + rows.at(-1)?.date
        }
      >
        <title>{title}</title>
        <desc>
          Date-based trend. Exact values are available in the data table below.
        </desc>
        {[min, (min + max) / 2, max].map((v, i) => (
          <g key={i}>
            <line x1="48" x2="752" y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
            <text
              x="42"
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#64748b"
            >
              {new Intl.NumberFormat("en", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v)}
            </text>
          </g>
        ))}
        <line
          x1="48"
          x2="752"
          y1={y(0)}
          y2={y(0)}
          stroke="#94a3b8"
          strokeDasharray="4 4"
        />
        <path
          d={line("value")}
          fill="none"
          stroke="#059669"
          strokeWidth="2.5"
        />
        {second && (
          <path
            d={line("other")}
            fill="none"
            stroke="#d97706"
            strokeWidth="2"
          />
        )}
        {rows.map((r, i) => (
          <circle
            key={r.date}
            cx={x(i)}
            cy={y(r.value)}
            r={rows.length > 100 ? 2 : 3}
            fill="#059669"
          >
            <title>
              {r.date}: {r.value.toLocaleString("en-IN")} {unit}
              {second ? `; cancelled: ${r.other ?? 0}` : ""}
            </title>
          </circle>
        ))}
        {[0, Math.floor((rows.length - 1) / 2), rows.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y="220"
              textAnchor="middle"
              fontSize="11"
              fill="#64748b"
            >
              {rows[i]?.date}
            </text>
          ))}
      </svg>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-emerald-700">
          View chart data
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Date</th>
                <th>{unit}</th>
                {second && <th>Cancelled</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="border-t" key={r.date}>
                  <td className="p-2">{r.date}</td>
                  <td>
                    {r.value.toLocaleString("en-IN", {
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  {second && <td>{r.other ?? 0}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function Ranking({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; name: string; meals: number; orders: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.meals));
  return (
    <section className={box}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">
        Top 10 by non-cancelled scheduled meal quantity
      </p>
      <ol className="mt-4 space-y-4">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{r.name}</span>
              <span className="shrink-0 tabular-nums">
                {r.meals.toLocaleString()} meals · {r.orders} orders
              </span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded bg-slate-100"
              aria-hidden="true"
            >
              <div
                className="h-full rounded bg-emerald-500"
                style={{ width: (r.meals / max) * 100 + "%" }}
              />
            </div>
          </li>
        ))}
      </ol>
      {!rows.length && (
        <p className="mt-4 text-sm text-slate-500">
          No scheduled meals in this range.
        </p>
      )}
    </section>
  );
}
export function AnalyticsDashboard({ initial }: { initial: AnalyticsReport }) {
  const [data, setData] = useState(initial),
    [from, setFrom] = useState(initial.from),
    [to, setTo] = useState(initial.to),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [period, setPeriod] = useState<"daily" | "weekly">("daily"),
    [currency, setCurrency] = useState(initial.revenue[0]?.currency ?? "");
  async function load(start = from, end = to) {
    setError("");
    const parsed = analyticsQuerySchema.safeParse({ from: start, to: end });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose valid dates.");
      return;
    }
    setBusy(true);
    try {
      const report = await apiClient.get<AnalyticsReport>(
        "/v1/admin/analytics?" + new URLSearchParams({ from: start, to: end }),
      );
      setData(report);
      setFrom(report.from);
      setTo(report.to);
      setCurrency((previous) =>
        report.revenue.some((r) => r.currency === previous)
          ? previous
          : (report.revenue[0]?.currency ?? ""),
      );
    } catch (e) {
      setError(
        toFormErrors(e).formError ?? "Could not load analytics. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  function preset(days: number) {
    const end = new Date(initial.to + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    void load(start.toISOString().slice(0, 10), initial.to);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void load();
  }
  const s = data.summary;
  const cards = [
    ["Orders placed", s.orders.toLocaleString(), "Includes cancelled orders."],
    [
      "Active customers",
      s.activeCustomers.toLocaleString(),
      "Customers with non-cancelled orders placed in range.",
    ],
    [
      "Active subscriptions (current)",
      s.activeSubscriptions.toLocaleString(),
      "Currently active plans overlapping this date range.",
    ],
    [
      "Cancellation rate",
      percent(s.cancellationRate),
      `${s.cancelledOrders} cancelled/refunded orders ÷ ${s.orders} orders placed.`,
    ],
    [
      "Failed delivery rate",
      percent(s.failedDeliveryRate),
      `${s.failed} failed ÷ ${s.delivered + s.failed} completed delivery attempts.`,
    ],
    [
      "On-time delivery rate",
      percent(s.onTimeDeliveryRate),
      `${s.onTime} on time ÷ ${s.timedDeliveries} delivered with timestamps.`,
    ],
  ];
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/admin" className="text-sm text-emerald-700">
          ← Admin dashboard
        </Link>
        <h1 className="text-3xl font-semibold">Analytics & reporting</h1>
        <p className="text-slate-600">
          Ordering trends, collections and delivery performance.
        </p>
      </header>
      <section className={box}>
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <label className="text-sm">
            From
            <input
              className={field}
              type="date"
              required
              value={from}
              disabled={busy}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            To (inclusive)
            <input
              className={field}
              type="date"
              required
              value={to}
              disabled={busy}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Button type="submit" loading={busy}>
            Apply dates
          </Button>
          {[7, 30, 90].map((days) => (
            <Button
              type="button"
              variant="secondary"
              key={days}
              disabled={busy}
              onClick={() => preset(days)}
            >
              Last {days} days
            </Button>
          ))}
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Maximum 366 days · Reporting timezone {data.timezone}
        </p>
      </section>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-slate-500">
        {busy
          ? "Updating report…"
          : `Showing ${data.from} through ${data.to} · Generated ${new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: data.timezone })}`}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, hint]) => (
          <section className={box} key={label}>
            <h2 className="text-sm text-slate-600">{label}</h2>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
            <p className="mt-2 text-xs text-slate-500">{hint}</p>
          </section>
        ))}
      </div>
      <section className={box}>
        <h2 className="text-xl font-semibold">Revenue & average order value</h2>
        <p className="mt-1 text-sm text-slate-500">
          Revenue is verified cash collections minus processed refunds.
          Currencies are never combined. Average order value uses non-cancelled
          orders placed in the range, including unpaid bookings and company
          contributions.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            ...new Set([
              ...data.revenue.map((r) => r.currency),
              ...data.averageOrderValue.map((r) => r.currency),
            ]),
          ]
            .sort()
            .map((c) => {
              const r = data.revenue.find((x) => x.currency === c);
              const a = data.averageOrderValue.find((x) => x.currency === c);
              return (
                <div key={c} className="rounded-lg bg-slate-50 p-4">
                  <h3 className="font-medium">{c}</h3>
                  <p className="mt-2 text-2xl font-semibold">
                    {amount(r?.net ?? "0", c)}{" "}
                    <span className="text-sm font-normal">net collections</span>
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <dt>Verified provider collections</dt>
                    <dd className="text-right">
                      {amount(r?.providerCollections ?? "0", c)}
                    </dd>
                    <dt>Settled corporate invoices</dt>
                    <dd className="text-right">
                      {amount(r?.corporateCollections ?? "0", c)}
                    </dd>
                    <dt>Processed refunds</dt>
                    <dd className="text-right">
                      {amount(r?.refunds ?? "0", c)}
                    </dd>
                    <dt>Average order value</dt>
                    <dd className="text-right">
                      {a ? amount(a.value, c) : "—"}
                    </dd>
                  </dl>
                  <p className="mt-2 text-xs text-slate-500">
                    {a?.orders ?? 0} non-cancelled orders in the order-value
                    calculation.
                  </p>
                </div>
              );
            })}
        </div>
        {!data.revenue.length && !data.averageOrderValue.length && (
          <p className="mt-4 text-slate-500">
            No collections or non-cancelled orders for this range.
          </p>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Order trend:</span>
        <Button
          variant={period === "daily" ? "primary" : "secondary"}
          aria-pressed={period === "daily"}
          onClick={() => setPeriod("daily")}
        >
          Daily
        </Button>
        <Button
          variant={period === "weekly" ? "primary" : "secondary"}
          aria-pressed={period === "weekly"}
          onClick={() => setPeriod("weekly")}
        >
          Weekly
        </Button>
        <span className="text-xs text-slate-500">
          Weeks begin Monday; boundary weeks include selected dates only.
        </span>
      </div>
      <TrendChart
        title={period === "daily" ? "Orders per day" : "Orders per week"}
        rows={data[period].map((r) => ({
          date: r.date,
          value: r.orders,
          other: r.cancelled,
        }))}
        second
      />
      {data.revenue.length > 0 && (
        <>
          <label className="block max-w-xs text-sm">
            Revenue chart currency
            <select
              className={field}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {data.revenue.map((r) => (
                <option key={r.currency}>{r.currency}</option>
              ))}
            </select>
          </label>
          <TrendChart
            title="Net collections by day"
            unit={currency}
            rows={data.dailyRevenue
              .filter((r) => r.currency === currency)
              .map((r) => ({ date: r.date, value: Number(r.net) }))}
          />
        </>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Ranking title="Popular meals" rows={data.popularMeals} />
        <Ranking title="Popular checkpoints" rows={data.popularCheckpoints} />
      </div>
      <section className={box}>
        <h2 className="text-xl font-semibold">Kitchen performance</h2>
        <p className="mt-1 text-xs text-slate-500">
          Top {data.limits.performance} kitchens by scheduled meal quantity.
          Preparation time averages valid preparing-to-packed timestamps per
          meal line.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <caption className="sr-only">
              Kitchen preparation and fulfilment performance
            </caption>
            <thead>
              <tr>
                {[
                  "Kitchen",
                  "Meals",
                  "Packed meals",
                  "Delivered meals",
                  "Failed meals",
                  "Avg prep (min)",
                ].map((t) => (
                  <th className="p-3" key={t} scope="col">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.kitchens.map((k) => (
                <tr className="border-t" key={k.id}>
                  <th scope="row" className="p-3 font-medium">
                    {k.name}
                  </th>
                  <td className="p-3">{k.meals}</td>
                  <td className="p-3">{k.packedMeals}</td>
                  <td className="p-3">{k.deliveredMeals}</td>
                  <td className="p-3">{k.failedMeals}</td>
                  <td className="p-3">
                    {k.averagePreparationMinutes?.toFixed(1) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.kitchens.length && (
            <p className="py-4 text-slate-500">
              No kitchen activity in this range.
            </p>
          )}
        </div>
      </section>
      <section className={box}>
        <h2 className="text-xl font-semibold">Delivery partner performance</h2>
        <p className="mt-1 text-xs text-slate-500">
          Top {data.limits.performance} partners by assigned deliveries. Pending
          deliveries are excluded from failure-rate denominators. Delivered
          records without a timestamp are excluded from on-time rates.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <caption className="sr-only">
              Delivery partner completion and punctuality
            </caption>
            <thead>
              <tr>
                {[
                  "Partner",
                  "Deliveries",
                  "Delivered",
                  "Failed",
                  "Failure rate",
                  "On-time rate",
                  "Timing coverage",
                ].map((t) => (
                  <th className="p-3" key={t} scope="col">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.partners.map((p) => (
                <tr className="border-t" key={p.id}>
                  <th className="p-3 font-medium" scope="row">
                    {p.name}
                  </th>
                  <td className="p-3">{p.deliveries}</td>
                  <td className="p-3">{p.delivered}</td>
                  <td className="p-3">{p.failed}</td>
                  <td className="p-3">{percent(p.failedDeliveryRate)}</td>
                  <td className="p-3">{percent(p.onTimeDeliveryRate)}</td>
                  <td className="p-3">
                    {p.timedDeliveries}/{p.delivered}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.partners.length && (
            <p className="py-4 text-slate-500">
              No assigned partner activity in this range.
            </p>
          )}
        </div>
      </section>
      <details className={box}>
        <summary className="cursor-pointer font-semibold">
          Metric definitions & data coverage
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            Orders and customers use placement dates (creation date when
            placement is unavailable) in {data.timezone}. Cancellation/refund
            state reflects the latest order status, including changes after the
            reporting range.
          </li>
          <li>
            Revenue uses payment capture dates, refund processing dates and
            verified corporate bank-settlement dates. It is a cash-collections
            report, not earned-revenue accounting. Issued but unsettled
            corporate invoices are excluded.
          </li>
          <li>
            Popularity, kitchen and delivery reports use scheduled service
            dates. Non-cancelled meal demand includes unpaid bookings; rankings
            sum quantities, not order rows.
          </li>
          <li>
            Active subscriptions are a current-state snapshot of active plans
            overlapping the selected dates, not a historical count of plans
            active at that time.
          </li>
          <li>
            On-time means delivery by the end of the checkpoint’s time slot,
            interpreted in that checkpoint city's timezone. {s.unknownTiming}{" "}
            delivered records have no timestamp; {s.timedDeliveries} of{" "}
            {s.delivered} delivered records are measurable. A dash means no
            eligible observations.
          </li>
          <li>
            Kitchen packing and preparation statistics require their recorded
            timestamps. Historical slot edits can change punctuality comparisons
            because delivery deadlines are derived from the current slot
            definition.
          </li>
        </ul>
      </details>
    </div>
  );
}
