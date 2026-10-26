import { UserRole, type RiderDashboard } from "@lunch/shared";
import { apiServer } from "@/lib/api.server";
import { requireRole } from "@/lib/session";
import { DeliveryDashboard } from "@/components/delivery/DeliveryQueue";
export default async function DeliveryPage() {
  await requireRole([UserRole.DELIVERY_PARTNER], "/delivery");
  return (
    <DeliveryDashboard
      data={await apiServer.get<RiderDashboard>("/delivery/dashboard")}
    />
  );
}
