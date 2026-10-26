"use client";
import { useState } from "react";
import { apiClient } from "@/lib/api.client";
import { Button } from "@/components/ui/Button";
import { toFormErrors } from "@/lib/form";
export function DeliveryCode({
  orderId,
  itemId,
}: {
  orderId: string;
  itemId: string;
}) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function issue() {
    setBusy(true);
    setError("");
    try {
      setCode(
        await apiClient.post(
          "/v1/orders/" + orderId + "/items/" + itemId + "/delivery-code",
        ),
      );
    } catch (e) {
      setError(toFormErrors(e).formError ?? "Unable to request code");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <Button size="sm" disabled={busy} onClick={issue}>
        {code ? "Replace delivery code" : "Get delivery code"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {code && (
        <div aria-live="polite">
          <p className="text-2xl font-bold tracking-widest">{code.code}</p>
          <p className="text-xs">
            Expires {new Date(code.expiresAt).toLocaleTimeString()}. Share only
            when receiving your meals.
          </p>
        </div>
      )}
    </div>
  );
}
