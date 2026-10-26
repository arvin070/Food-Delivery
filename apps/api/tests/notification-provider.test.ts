import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/config/env', async (original) => {
  const actual = await original<typeof import('../src/config/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      NOTIFICATION_GATEWAY_URL: 'https://notifications.example.test/send',
      NOTIFICATION_GATEWAY_TOKEN: 'test-gateway-credential',
    },
  };
});
import {
  GatewayProvider,
  type NotificationMessage,
} from '../src/modules/notifications/providers';
const provider = new GatewayProvider();
const message: NotificationMessage = {
  channel: 'WHATSAPP',
  idempotencyKey: 'notification-1',
  destinations: ['+919999999999'],
  title: 'Meal delivered',
  body: "Rahul's lunch was delivered at Gate A.",
  template: 'delivery.delivered',
  templateVersion: 1,
  variables: { beneficiary: 'Rahul', meal: 'lunch', checkpoint: 'Gate A' },
};
afterEach(() => vi.unstubAllGlobals());
describe('notification gateway adapter', () => {
  it('passes the versioned template and stable idempotency key with server credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messageId: 'provider-1' }), {
          status: 202,
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await provider.send(message)).toEqual({ messageId: 'provider-1' });
    expect(fetcher.mock.calls[0]![0]).toBe(
      'https://notifications.example.test/send',
    );
    const options = fetcher.mock.calls[0]![1] as RequestInit;
    expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({
      'Idempotency-Key': 'notification-1',
      Authorization: 'Bearer test-gateway-credential',
    });
    expect(JSON.parse(options.body as string)).toEqual(message);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('classifies throttling and server failures as retryable, and rejects permanent client failures', async () => {
    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [400, false],
      [401, false],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response('private provider details', { status }),
          ),
      );
      await expect(provider.send(message)).rejects.toMatchObject({
        code: 'PROVIDER_HTTP_' + status,
        retryable,
      });
    }
  });
  it('sanitizes transport errors and rejects receipts without a message ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('sensitive endpoint/token')),
    );
    await expect(provider.send(message)).rejects.toMatchObject({
      message: 'PROVIDER_UNREACHABLE',
      retryable: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    await expect(provider.send(message)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      retryable: true,
    });
  });
});
