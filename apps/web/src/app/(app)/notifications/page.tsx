import type { NotificationInbox, NotificationSettings } from '@lunch/shared';
import { requireUser } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
export const metadata = { title: 'Notifications' };
export default async function NotificationsPage() {
  await requireUser('/notifications');
  const [initial, settings] = await Promise.all([
    apiServer.get<NotificationInbox>('/notifications'),
    apiServer.get<NotificationSettings>('/notifications/preferences'),
  ]);
  return <NotificationCenter initial={initial} settings={settings} />;
}
