'use client';
import { useEffect, useState } from 'react';
import {
  notificationEvents,
  type NotificationEvent,
  type NotificationInbox,
  type NotificationSettings,
  type NotificationPreferences,
} from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
const labels: Record<NotificationEvent, string> = {
  'account.created': 'Account created',
  'order.confirmed': 'Order confirmed',
  'payment.successful': 'Payment successful',
  'meal.preparing': 'Meal preparing',
  'meal.packed': 'Meal packed',
  'delivery.assigned': 'Delivery partner assigned',
  'delivery.started': 'Delivery started',
  'delivery.arriving': 'Delivery arriving',
  'delivery.delivered': 'Delivered',
  'delivery.late': 'Delivery delayed',
  'delivery.failed': 'Failed delivery',
  'subscription.renewal': 'Subscription renewal reminder',
  'subscription.paused': 'Subscription paused',
  'payment.failed': 'Payment failed',
};
function errorMessage(e: unknown) {
  const err = toFormErrors(e);
  return (
    err.formError ??
    Object.values(err.fields)[0] ??
    'Could not update notifications.'
  );
}
export function NotificationCenter({
  initial,
  settings,
}: {
  initial: NotificationInbox;
  settings: NotificationSettings;
}) {
  const [inbox, setInbox] = useState(initial),
    [preferences, setPreferences] = useState<NotificationPreferences>(
      settings.preferences,
    );
  const [page, setPage] = useState(1),
    [unreadOnly, setUnreadOnly] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [devices, setDevices] = useState(settings.devices);
  useEffect(() => {
    let active = true;
    setLoading(true);
    apiClient
      .get<NotificationInbox>(
        '/v1/notifications?page=' + page + '&unread=' + unreadOnly,
      )
      .then((data) => {
        if (active) setInbox(data);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, unreadOnly, refresh]);
  async function read(id?: string) {
    setBusy(true);
    setError('');
    try {
      await apiClient.post(
        id ? '/v1/notifications/' + id + '/read' : '/v1/notifications/read-all',
      );
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiClient.put('/v1/notifications/preferences', preferences);
      setNotice('Notification preferences saved.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeDevice(id: string) {
    setBusy(true);
    setError('');
    try {
      await apiClient.delete('/v1/notifications/devices/' + id);
      setDevices((old) => old.filter((d) => d.id !== id));
      setNotice('Device removed from push notifications.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">Notifications</h1>
        <p className="mt-2 text-slate-600">
          Updates about your meals, deliveries and subscriptions.
        </p>
      </header>
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
      <section className="space-y-4" aria-label="Notification inbox">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            Inbox{' '}
            <span className="text-sm font-normal text-slate-500">
              ({inbox.unread} unread)
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy || loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !inbox.unread}
              onClick={() => read()}
            >
              Mark all read
            </Button>
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setPage(1);
              setUnreadOnly(e.target.checked);
            }}
          />
          Unread only
        </label>
        {loading && (
          <p role="status" className="text-sm text-slate-500">
            Loading updates…
          </p>
        )}
        {!loading && !inbox.items.length && (
          <p className="rounded-xl border p-8 text-center text-slate-500">
            No notifications here yet.
          </p>
        )}
        <ul className="space-y-3">
          {inbox.items.map((item) => (
            <li
              key={item.id}
              className={
                'rounded-xl border p-4 ' +
                (item.readAt ? 'bg-white' : 'border-emerald-200 bg-emerald-50')
              }
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">
                  {!item.readAt && (
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-600"
                      aria-label="Unread"
                    />
                  )}
                  {item.title}
                </h3>
                <time
                  className="text-xs text-slate-500"
                  dateTime={item.createdAt}
                >
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {item.body}
              </p>
              {!item.readAt && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  disabled={busy}
                  onClick={() => read(item.id)}
                >
                  Mark read
                </Button>
              )}
            </li>
          ))}
        </ul>
        <nav className="flex items-center justify-between">
          <Button
            variant="secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-slate-600">
            Page {page} · {inbox.total} updates
          </span>
          <Button
            variant="secondary"
            disabled={page * inbox.pageSize >= inbox.total || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </nav>
      </section>
      <section className="space-y-4 rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Notification preferences</h2>
        {!settings.externalDeliveryConfigured && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm">
            Email, SMS, WhatsApp and push alerts are not available yet. In-app
            notifications are available; your other preferences will be saved.
          </p>
        )}
        <fieldset disabled={busy} className="space-y-5">
          <div>
            <h3 className="font-medium">Where to receive updates</h3>
            <p className="mt-1 text-sm text-slate-500">
              Email and phone alerts use verified contact details. Push alerts
              need a registered device.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['inApp', 'In-app inbox'],
                  ['email', 'Email'],
                  ['sms', 'SMS'],
                  ['whatsapp', 'WhatsApp'],
                  ['push', 'Push notifications'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={preferences[key]}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-medium">Updates you want</h3>
            <p className="mt-1 text-sm text-slate-500">
              These choices apply to every channel. Delivery confirmations for
              children follow the parent’s preferences.
            </p>
            <div className="mt-3 grid gap-1 sm:grid-cols-2">
              {notificationEvents.map((event) => (
                <label
                  key={event}
                  className="flex min-h-11 items-center gap-3 text-sm"
                >
                  <input
                    className="h-4 w-4"
                    type="checkbox"
                    checked={!preferences.disabledEvents.includes(event)}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        disabledEvents: e.target.checked
                          ? p.disabledEvents.filter((v) => v !== event)
                          : [...p.disabledEvents, event],
                      }))
                    }
                  />
                  {labels[event]}
                </label>
              ))}
            </div>
          </div>
          <Button loading={busy} onClick={save}>
            Save preferences
          </Button>
        </fieldset>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Push devices</h2>
        {!devices.length && (
          <p className="text-sm text-slate-500">No devices registered.</p>
        )}
        {devices.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <span className="text-sm">
              {d.platform} · registered{' '}
              {new Date(d.updatedAt).toLocaleDateString()}
            </span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => removeDevice(d.id)}
            >
              Remove
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
