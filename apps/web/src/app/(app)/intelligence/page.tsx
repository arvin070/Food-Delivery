import { UserRole, type IntelligenceOptions } from "@lunch/shared";
import { requireRole } from "@/lib/session";
import { apiServer } from "@/lib/api.server";
import { IntelligenceDashboard } from "@/components/intelligence/IntelligenceDashboard";
export const metadata = { title: "Lunch assistant" };
export default async function Page() {
  await requireRole(
    [UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT],
    "/intelligence",
  );
  return (
    <IntelligenceDashboard
      admin={false}
      options={await apiServer.get<IntelligenceOptions>(
        "/intelligence/options",
      )}
      today={new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())}
    />
  );
}
