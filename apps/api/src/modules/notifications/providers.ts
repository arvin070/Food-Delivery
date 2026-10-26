import type { NotificationChannel } from '@prisma/client';
import { env } from '../../config/env';
export type ExternalChannel = Exclude<NotificationChannel, 'IN_APP'>;
export interface NotificationMessage {
  idempotencyKey: string;
  channel: ExternalChannel;
  destinations: string[];
  title: string;
  body: string;
  template: string;
  templateVersion: number;
  variables: Record<string, string>;
}
export interface NotificationProvider {
  send(message: NotificationMessage): Promise<{ messageId: string }>;
}
export class DeliveryError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
  ) {
    super(code);
  }
}
/** Provider gateway contract: accept plain text; deduplicate by Idempotency-Key.
 * Gateway implementations own vendor APIs, WhatsApp template approval, and push SDKs. */
export class GatewayProvider implements NotificationProvider {
  async send(message: NotificationMessage) {
    if (!env.NOTIFICATION_GATEWAY_URL || !env.NOTIFICATION_GATEWAY_TOKEN)
      throw new DeliveryError('PROVIDER_NOT_CONFIGURED', false);
    let response: Response;
    try {
      response = await fetch(env.NOTIFICATION_GATEWAY_URL, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + env.NOTIFICATION_GATEWAY_TOKEN,
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify(message),
      });
    } catch {
      throw new DeliveryError('PROVIDER_UNREACHABLE', true);
    }
    if (!response.ok)
      throw new DeliveryError(
        'PROVIDER_HTTP_' + response.status,
        response.status === 429 || response.status >= 500,
      );
    try {
      const receipt = (await response.json()) as { messageId?: unknown };
      if (
        typeof receipt.messageId !== 'string' ||
        !receipt.messageId ||
        receipt.messageId.length > 200
      )
        throw new Error();
      return { messageId: receipt.messageId };
    } catch {
      throw new DeliveryError('INVALID_PROVIDER_RESPONSE', true);
    }
  }
}
class UnconfiguredProvider implements NotificationProvider {
  async send(_message: NotificationMessage): Promise<{ messageId: string }> {
    throw new DeliveryError('PROVIDER_NOT_CONFIGURED', false);
  }
}
export type ProviderRegistry = Record<ExternalChannel, NotificationProvider>;
export function notificationProviders(): ProviderRegistry {
  const provider =
    env.NOTIFICATION_PROVIDER === 'gateway'
      ? new GatewayProvider()
      : new UnconfiguredProvider();
  return { EMAIL: provider, SMS: provider, WHATSAPP: provider, PUSH: provider };
}
