"use client";
import { useState } from "react";
import Link from "next/link";
import type {
  IntelligenceOptions,
  Recommendations,
  DemandForecast,
  RouteSuggestion,
  SupportAnswer,
} from "@lunch/shared";
import { apiClient } from "@/lib/api.client";
import { toFormErrors } from "@/lib/form";
import { Button } from "@/components/ui/Button";
const box = "rounded-xl border border-slate-200 bg-white p-5";
const field = "mt-1 block w-full rounded-lg border border-slate-300 p-2.5";
export function IntelligenceDashboard({
  options,
  admin,
  today,
}: {
  options: IntelligenceOptions;
  admin: boolean;
  today: string;
}) {
  const [checkpointId, setCheckpoint] = useState(
      options.checkpoints[0]?.id ?? "",
    ),
    [date, setDate] = useState(today),
    [kitchenId, setKitchen] = useState(options.kitchens[0]?.id ?? ""),
    [departure, setDeparture] = useState("11:30"),
    [capacity, setCapacity] = useState(80),
    [question, setQuestion] = useState("Where is my lunch?"),
    [orderId, setOrder] = useState(""),
    [subscriptionId, setSubscription] = useState(""),
    [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [meals, setMeals] = useState<Recommendations | null>(null),
    [demand, setDemand] = useState<DemandForecast | null>(null),
    [routes, setRoutes] = useState<RouteSuggestion | null>(null),
    [answer, setAnswer] = useState<SupportAnswer | null>(null);
  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(
        toFormErrors(e).formError ??
          "Could not retrieve verified data. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  const query = new URLSearchParams({ checkpointId, date });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">
          {admin ? "Intelligence & planning" : "Lunch assistant"}
        </h1>
        <p className="mt-2 text-slate-600">
          {admin
            ? "Demand estimates and route suggestions for operational review."
            : "Meal suggestions and answers based on your Lunch records."}
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className={box}>
        <legend className="px-2 font-medium">Delivery selection</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            Checkpoint
            <select
              value={checkpointId}
              onChange={(e) => setCheckpoint(e.target.value)}
              className={field}
            >
              {options.checkpoints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Service date
            <input
              type="date"
              className={field}
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Choose a date within the next 30 days. Results retain the date they
          were generated for.
        </p>
      </fieldset>
      {admin ? (
        <>
          <section className={box}>
            <h2 className="text-xl font-semibold">Demand prediction</h2>
            <p className="my-3 text-sm text-slate-600">
              Uses historical orders at this checkpoint, grouped by meal and day
              of week. Limited history is shown as insufficient data.
            </p>
            <Button
              disabled={busy || !checkpointId || !date}
              onClick={() =>
                void run(async () =>
                  setDemand(
                    await apiClient.get<DemandForecast>(
                      "/v1/intelligence/demand?" + query,
                    ),
                  ),
                )
              }
            >
              Predict demand
            </Button>
            {demand && (
              <div className="mt-5 space-y-3">
                <p className="font-medium">
                  {demand.checkpoint} ·{" "}
                  {demand.institution ?? "Independent checkpoint"} ·{" "}
                  {demand.date} ({demand.dayOfWeek})
                </p>
                <p className="text-sm text-slate-500">
                  {demand.observations} comparable weekdays · History{" "}
                  {demand.historyFrom}–{demand.historyTo}
                  {demand.closed ? " · Holiday closure" : ""}
                </p>
                <div className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        {[
                          "Meal",
                          "Period",
                          "Expected",
                          "Range",
                          "Booked",
                          "Evidence",
                        ].map((t) => (
                          <th key={t} className="p-2">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {demand.rows.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{r.meal}</td>
                          <td>{r.period}</td>
                          <td>{r.expected ?? "Insufficient data"}</td>
                          <td>{r.low === null ? "—" : r.low + "–" + r.high}</td>
                          <td>{r.booked}</td>
                          <td>{r.confidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!demand.rows.length && (
                  <p>
                    No historical demand or bookings were found for this
                    selection.
                  </p>
                )}
                <Notes rows={demand.warnings} />
              </div>
            )}
          </section>
          <section className={box}>
            <h2 className="text-xl font-semibold">
              Delivery route suggestions
            </h2>
            <div className="my-4 grid gap-3 sm:grid-cols-3">
              <label>
                Kitchen
                <select
                  className={field}
                  value={kitchenId}
                  disabled={busy}
                  onChange={(e) => setKitchen(e.target.value)}
                >
                  {options.kitchens.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Departure (kitchen local time)
                <input
                  className={field}
                  type="time"
                  value={departure}
                  disabled={busy}
                  onChange={(e) => setDeparture(e.target.value)}
                />
              </label>
              <label>
                Meals per rider
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={500}
                  value={capacity}
                  disabled={busy}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                />
              </label>
            </div>
            <Button
              disabled={busy || !kitchenId || !date || !departure}
              onClick={() =>
                void run(async () => {
                  const [h, m] = departure.split(":").map(Number);
                  setRoutes(
                    await apiClient.post<RouteSuggestion>(
                      "/v1/intelligence/routes",
                      {
                        kitchenId,
                        date,
                        departureMinute: h! * 60 + m!,
                        maxMeals: capacity,
                      },
                    ),
                  );
                })
              }
            >
              Suggest routes
            </Button>
            <Link
              href="/admin/routes"
              className="ml-4 text-sm text-emerald-700"
            >
              Review & assign routes →
            </Link>
            {routes && (
              <div className="mt-5 space-y-4">
                <p className="font-medium">
                  {routes.kitchen} · {routes.date}
                </p>
                <p className="text-sm">
                  Travel assumption: {routes.assumptions.speedKmh} km/h,{" "}
                  {routes.assumptions.stopMinutes} minutes per stop,{" "}
                  {routes.assumptions.maxMeals} meals per rider.
                </p>
                {routes.routes.map((r) => (
                  <article
                    key={r.partner.id}
                    className="rounded-lg bg-slate-50 p-4"
                  >
                    <h3 className="font-semibold">
                      {r.partner.name} · {r.meals} meals · ~{r.distanceKm} km
                    </h3>
                    <ol className="mt-3 list-decimal space-y-2 pl-5">
                      {r.stops.map((s) => (
                        <li key={s.checkpointId + s.slotId}>
                          {s.checkpoint} · {s.slot} · {s.meals} meals{" "}
                          <span className="text-sm text-slate-500">
                            (estimated arrival{" "}
                            {new Date(s.arrival).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            , browser local time)
                          </span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
                {!routes.routes.length && (
                  <p>No feasible route suggestions for this selection.</p>
                )}
                {routes.unassigned.length > 0 && (
                  <div>
                    <h3 className="font-medium">Needs manual planning</h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {routes.unassigned.map((u, i) => (
                        <li key={i}>
                          {u.checkpoint} · {u.meals} meals — {u.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Notes rows={routes.warnings} />
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <section className={box}>
            <h2 className="text-xl font-semibold">Meals for you</h2>
            <label className="my-3 block max-w-xs text-sm">
              Meal time
              <select
                className={field}
                value={period}
                disabled={busy}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="">All available times</option>
                {["BREAKFAST", "LUNCH", "SNACKS", "DINNER"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy || !checkpointId || !date}
              onClick={() =>
                void run(async () => {
                  const q = new URLSearchParams(query);
                  if (period) q.set("mealPeriod", period);
                  setMeals(
                    await apiClient.get<Recommendations>(
                      "/v1/intelligence/recommendations?" + q,
                    ),
                  );
                })
              }
            >
              Recommend meals
            </Button>
            {meals && (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-slate-500">
                  Available for {meals.date} · Checked{" "}
                  {new Date(meals.asOf).toLocaleString()}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {meals.meals.map((m) => (
                    <article
                      key={m.scheduleId}
                      className="rounded-lg border p-4"
                    >
                      <h3 className="font-semibold">{m.name}</h3>
                      <p className="mt-1 text-sm">
                        {m.slot} · ₹{m.price} · {m.remaining} remaining
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        {m.reasons.join(" · ")}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Declared allergens:{" "}
                        {m.allergens.join(", ") ||
                          "None declared (not a safety guarantee)"}
                      </p>
                    </article>
                  ))}
                </div>
                {!meals.meals.length && (
                  <p>No matching meals are available for this selection.</p>
                )}
                {meals.truncated && (
                  <p className="text-sm">
                    Suggestions were ranked from the first 500 matching
                    schedules.
                  </p>
                )}
                <Notes rows={meals.warnings} />
                <Link href="/meals" className="inline-block text-emerald-700">
                  Browse & order meals →
                </Link>
              </div>
            )}
          </section>
          <section className={box}>
            <h2 className="text-xl font-semibold">Ask Lunch</h2>
            <p className="my-3 text-sm text-slate-600">
              I check your records before answering. Skips and other changes
              must be submitted through the relevant screen.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                "Where is my lunch?",
                "Can I skip tomorrow?",
                "What meals are available?",
                "Why did my payment fail?",
              ].map((q) => (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-full border px-3 py-2 text-xs hover:bg-slate-50"
                  key={q}
                  onClick={() => setQuestion(q)}
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  setAnswer(null);
                  setAnswer(
                    await apiClient.post<SupportAnswer>(
                      "/v1/intelligence/support",
                      {
                        question,
                        ...(orderId ? { orderId } : {}),
                        ...(subscriptionId ? { subscriptionId } : {}),
                        ...(checkpointId ? { checkpointId } : {}),
                        ...(/available|recommend|menu/i.test(question)
                          ? { date }
                          : {}),
                      },
                    ),
                  );
                });
              }}
              className="mt-4 space-y-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  Order (optional)
                  <select
                    className={field}
                    value={orderId}
                    disabled={busy}
                    onChange={(e) => setOrder(e.target.value)}
                  >
                    <option value="">Choose if needed</option>
                    {options.orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.orderNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Subscription (optional)
                  <select
                    className={field}
                    value={subscriptionId}
                    disabled={busy}
                    onChange={(e) => setSubscription(e.target.value)}
                  >
                    <option value="">Choose if needed</option>
                    {options.subscriptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                Your question
                <textarea
                  className={field}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  required
                  minLength={3}
                  maxLength={500}
                  disabled={busy}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Ask assistant
              </Button>
            </form>
            {answer && (
              <div
                role="status"
                className="mt-5 space-y-3 rounded-lg bg-slate-50 p-4"
              >
                <p>{answer.answer}</p>
                <dl className="space-y-2 text-sm">
                  {answer.facts.map((f, i) => (
                    <div key={i}>
                      <dt className="font-medium">{f.label}</dt>
                      <dd className="break-words">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-4">
                  {answer.sources.map((s) => (
                    <Link
                      key={s.href}
                      href={s.href}
                      className="text-sm text-emerald-700"
                    >
                      {s.label} →
                    </Link>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Checked {new Date(answer.asOf).toLocaleString()} · No changes
                  made
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {busy && (
        <p role="status" className="text-sm text-slate-500">
          Checking application data…
        </p>
      )}
    </div>
  );
}
function Notes({ rows }: { rows: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
      {rows.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}
