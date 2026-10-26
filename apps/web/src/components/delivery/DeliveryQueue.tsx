"use client";
import Link from "next/link";
import { RiderTracking, useRiderSharing } from "@/components/tracking/RiderTracking";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RiderDashboard, RiderStopDetail } from "@lunch/shared";
import { apiClient } from "@/lib/api.client";
import { Button } from "@/components/ui/Button";
import { toFormErrors } from "@/lib/form";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(path: string, body = {}, patch = false) {
    setBusy(true);
    setError("");
    try {
      if (patch) await apiClient.patch("/v1/delivery/" + path, body);
      else await apiClient.post("/v1/delivery/" + path, body);
      router.refresh();
    } catch (e) {
      setError(
        toFormErrors(e).formError ??
          "Could not update delivery. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return { act, busy, error };
}
export function DeliveryDashboard({ data }: { data: RiderDashboard }) {
  const sharing = useRiderSharing();
  const { act, busy, error } = useAction();
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header>
        <p className="text-sm text-slate-500">Delivery partner</p>
        <h1 className="text-3xl font-semibold">Today’s routes</h1>
        <p className="mt-2 text-sm text-slate-600">
          Collect your meals, follow the checkpoints, and verify each handoff.
        </p>
      </header>
      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 flex items-center justify-between gap-3">
        <span>
          {data.partner.isAvailable
            ? "Available for assignments"
            : "Unavailable for new assignments"}
        </span>
        <Button
          disabled={busy}
          onClick={() => {
            if (data.partner.isAvailable) sharing.stop();
            void act(
              "availability",
              { isAvailable: !data.partner.isAvailable },
              true,
            );
          }}
        >
          {data.partner.isAvailable ? "Go offline" : "Go available"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Deliveries", data.totals.deliveries],
          ["Meals", data.totals.meals],
          ["Delivered", data.totals.delivered],
        ].map(([label, count]) => (
          <div key={label} className="rounded-xl bg-emerald-50 p-4">
            <p className="text-2xl font-bold">{count}</p>
            <p className="text-xs">{label}</p>
          </div>
        ))}
      </div>
      {!data.routes.length && (
        <p className="rounded-xl border p-6">
          No routes assigned today. New assignments will appear here.
        </p>
      )}
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => window.location.reload()}
      >
        Refresh assignments
      </Button>
      {data.routes.map((r) => (
        <section
          key={r.id}
          className="rounded-xl bg-white p-4 ring-1 ring-slate-200 space-y-4"
        >
          <div>
            <h2 className="text-xl font-semibold">
              {r.timeSlots.map(s=>s.label).join(" / ")} · {r.kitchen.name}
            </h2>
            <p className="text-sm text-slate-600">
              {r.serviceDate} · {r.deliveryCount} deliveries · {r.mealCount}{" "}
              meals
            </p>
            <p className="text-sm">
              {r.completedCount} delivered · {r.failedCount} failed
            </p>
          </div>
          {r.status !== "COMPLETED" && (
            <Button
              className="w-full min-h-12"
              disabled={busy || !!r.departedAt}
              onClick={() =>
                act("routes/" + r.id + (r.startedAt ? "/start" : "/pickup"))
              }
            >
              {r.departedAt
                ? "Route in progress"
                : r.startedAt
                  ? "Start route"
                  : "Confirm meal pickup"}
            </Button>
          )}
          {r.status === "COMPLETED" && (
            <p className="font-medium text-emerald-700">Route complete</p>
          )}
          <RiderTracking route={r} />
          <ol className="divide-y">
            {r.stops.map((s) => (
              <li key={s.id}>
                <Link
                  className="block py-4"
                  href={"/delivery/routes/" + r.id + "/stops/" + s.id}
                >
                  <span className="font-semibold">
                    {s.sequence}. {s.checkpoint.name} →
                  </span>
                  <p className="text-sm text-slate-500">
                    {s.mealCount} meals · {s.deliveryCount} deliveries ·{" "}
                    {s.status.toLowerCase()}
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
export function DeliveryStop({ data }: { data: RiderStopDetail }) {
  const { act, busy, error } = useAction();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const stop = data.route.stops.find((s) => s.id === data.stopId)!;
  const inputClass =
    "block w-full min-h-12 rounded-lg border border-slate-300 p-3 mt-1";
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/delivery" className="inline-block py-3 text-emerald-700">
        ← Today’s routes
      </Link>
      <h1 className="text-2xl font-semibold">{stop.checkpoint.name}</h1>
      <p>
        {data.route.timeSlots.map(s=>s.label).join(" / ")} · {stop.mealCount} meals
      </p>
      <RiderTracking route={data.route} />
      {stop.checkpoint.instructions && (
        <p className="rounded-xl bg-amber-50 p-4">
          {stop.checkpoint.instructions}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {(stop.status === "PENDING" || data.deliveries.some(d => d.status === "OUT_FOR_DELIVERY")) && (
        <Button
          className="w-full min-h-12"
          disabled={busy || !data.route.departedAt}
          onClick={() =>
            act("routes/" + data.route.id + "/stops/" + stop.id + "/arrive")
          }
        >
          Arrive at checkpoint
        </Button>
      )}
      {data.deliveries.map((d) => (
        <article
          key={d.id}
          className="rounded-xl bg-white p-4 ring-1 ring-slate-200 space-y-3"
        >
          <h2 className="text-lg font-semibold">{d.beneficiaryName}</h2>
          <p>
            {d.quantity} × {d.mealName} · {d.timeSlot.label}
          </p>
          <p className="text-sm text-slate-500">
            {d.orderNumber} · {d.status.toLowerCase().replaceAll("_", " ")}
          </p>
          {d.checkpoint.addressLabel && (
            <p className="text-sm">{d.checkpoint.addressLabel}</p>
          )}
          {d.status === "AT_CHECKPOINT" && (
            <>
              <label className="block text-sm">
                Receiver name
                <input
                  className={inputClass}
                  value={names[d.id] ?? ""}
                  onChange={(e) =>
                    setNames({ ...names, [d.id]: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm">
                Customer’s 6-digit delivery code
                <input
                  className={inputClass}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codes[d.id] ?? ""}
                  onChange={(e) =>
                    setCodes({
                      ...codes,
                      [d.id]: e.target.value.replace(/\D/g, ""),
                    })
                  }
                />
              </label>
              <p className="text-xs text-slate-500">
                Ask the customer to open their order and request a delivery
                code.
              </p>
              <Button
                className="w-full min-h-12"
                disabled={
                  busy ||
                  (names[d.id] ?? "").trim().length < 2 ||
                  !/^\d{6}$/.test(codes[d.id] ?? "")
                }
                onClick={() =>
                  act(
                    "items/" + d.id + "/status",
                    {
                      status: "DELIVERED",
                      receiverName: names[d.id],
                      otp: codes[d.id],
                    },
                    true,
                  )
                }
              >
                Verify & mark delivered
              </Button>
            </>
          )}
          {!["DELIVERED", "FAILED"].includes(d.status) && (
            <details>
              <summary className="cursor-pointer py-3 text-red-700">
                Unable to deliver
              </summary>
              <label className="block text-sm">
                Reason
                <textarea
                  className={inputClass}
                  maxLength={500}
                  value={reasons[d.id] ?? ""}
                  onChange={(e) =>
                    setReasons({ ...reasons, [d.id]: e.target.value })
                  }
                />
              </label>
              <Button
                variant="danger"
                className="mt-3 w-full min-h-12"
                disabled={busy || (reasons[d.id] ?? "").trim().length < 3}
                onClick={() =>
                  act(
                    "items/" + d.id + "/status",
                    { status: "FAILED", failureReason: reasons[d.id] },
                    true,
                  )
                }
              >
                Record failed delivery
              </Button>
            </details>
          )}
          {d.failureReason && <p className="text-red-700">{d.failureReason}</p>}
        </article>
      ))}
      <nav className="flex justify-between">
        {data.page > 1 && (
          <Link className="py-4" href={"?page=" + (data.page - 1)}>
            Previous
          </Link>
        )}
        {data.total > data.page * data.pageSize && (
          <Link className="py-4" href={"?page=" + (data.page + 1)}>
            Next deliveries →
          </Link>
        )}
      </nav>
    </div>
  );
}
