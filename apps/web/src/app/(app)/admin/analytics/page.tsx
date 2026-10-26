import { UserRole, type AnalyticsReport } from "@lunch/shared";
import { apiServer } from "@/lib/api.server";
import { requireRole } from "@/lib/session";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
export const metadata = { title: "Analytics & reporting" };
export default async function AnalyticsPage() {
  await requireRole([UserRole.SUPER_ADMIN], "/admin/analytics");
  return (
    <AnalyticsDashboard
      initial={await apiServer.get<AnalyticsReport>("/admin/analytics")}
    />
  );
}
