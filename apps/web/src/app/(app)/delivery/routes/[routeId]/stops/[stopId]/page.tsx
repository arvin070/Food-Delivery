import { UserRole, type RiderStopDetail } from "@lunch/shared";
import { apiServer } from "@/lib/api.server";
import { requireRole } from "@/lib/session";
import { DeliveryStop } from "@/components/delivery/DeliveryQueue";
export default async function StopPage({
  params,
  searchParams,
}: {
  params: Promise<{ routeId: string; stopId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireRole([UserRole.DELIVERY_PARTNER], "/delivery");
  const { routeId, stopId } = await params;
  const { page } = await searchParams;
  return (
    <DeliveryStop
      data={await apiServer.get<RiderStopDetail>(
        "/delivery/routes/" +
          encodeURIComponent(routeId) +
          "/stops/" +
          encodeURIComponent(stopId) +
          "?page=" +
          encodeURIComponent(page ?? "1"),
      )}
    />
  );
}
