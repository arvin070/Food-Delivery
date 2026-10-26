'use client';
import { useRef, useState } from 'react';
import { apiClient } from '@/lib/api.client';
import { Button } from '@/components/ui/Button';
import { toFormErrors } from '@/lib/form';
export interface ComplaintList {
  items: {
    id: string;
    subject: string;
    message: string;
    status: string;
    response: string | null;
    createdAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
}
export function SupportCenter({
  initial,
  orders,
}: {
  initial: ComplaintList;
  orders: { id: string; orderNumber: string }[];
}) {
  const [data, setData] = useState(initial),
    [subject, setSubject] = useState(''),
    [message, setMessage] = useState(''),
    [orderId, setOrderId] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  async function load(page = 1) {
    setData(await apiClient.get<ComplaintList>('/v1/complaints?page=' + page));
  }
  async function submit() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = JSON.stringify({ subject, message, orderId });
      if (request.current?.body !== body)
        request.current = { body, key: crypto.randomUUID() };
      await apiClient.post('/v1/complaints', {
        subject,
        message,
        ...(orderId ? { orderId } : {}),
        idempotencyKey: request.current.key,
      });
      setSubject('');
      setMessage('');
      setOrderId('');
      setNotice('Your complaint has been submitted. Replies will appear here.');
      await load();
    } catch (e) {
      setError(toFormErrors(e).formError ?? 'Could not submit your complaint.');
    } finally {
      setBusy(false);
    }
  }
  async function changePage(page: number) {
    setBusy(true);
    setError('');
    try {
      await load(page);
    } catch (e) {
      setError(toFormErrors(e).formError ?? 'Could not load complaints.');
    } finally {
      setBusy(false);
    }
  }
  const field = 'mt-1 block w-full rounded-lg border p-3';
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold">Help & complaints</h1>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      <form
        className="space-y-4 rounded-xl border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm">
          Subject
          <input
            className={field}
            required
            minLength={3}
            maxLength={160}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Related order (optional)
          <select
            className={field}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          >
            <option value="">General issue</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Tell us what happened
          <textarea
            className={field}
            required
            minLength={10}
            maxLength={4000}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <Button type="submit" loading={busy}>
          Submit complaint
        </Button>
      </form>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Your complaints</h2>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => changePage(data.page)}
          >
            Refresh
          </Button>
        </div>
        {!data.items.length && (
          <p className="text-slate-500">No complaints yet.</p>
        )}
        {data.items.map((c) => (
          <article key={c.id} className="rounded-xl border p-4">
            <h3 className="font-semibold">{c.subject}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {c.status.toLowerCase().replaceAll('_', ' ')} ·{' '}
              {new Date(c.createdAt).toLocaleDateString()}
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm">{c.message}</p>
            {c.response && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
                <p className="font-medium">Support response</p>
                <p className="mt-1 whitespace-pre-wrap">{c.response}</p>
              </div>
            )}
          </article>
        ))}
      </section>
      <nav className="flex justify-between">
        <Button
          variant="secondary"
          disabled={busy || data.page === 1}
          onClick={() => changePage(data.page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">{data.total} complaints</span>
        <Button
          variant="secondary"
          disabled={busy || data.page * data.pageSize >= data.total}
          onClick={() => changePage(data.page + 1)}
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
