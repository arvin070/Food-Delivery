/**
 * Outbound message delivery.
 *
 * Password reset and account verification both need to send a code to an email
 * address or a phone number. The transport is deliberately behind an interface:
 * the MVP logs codes to the console, and swapping in SES, Twilio or MSG91 later
 * is a new `Notifier` implementation plus one line in `createNotifier` — no
 * change to any service that sends a message.
 */
import { env, isProduction } from '../config/env';
import { logger } from './logger';

export type NotificationChannel = 'email' | 'phone';

export interface OutboundMessage {
  channel: NotificationChannel;
  /** Email address or phone number. */
  to: string;
  subject: string;
  body: string;
}

export interface Notifier {
  readonly name: string;
  send(message: OutboundMessage): Promise<void>;
}

/**
 * Development transport: writes the message to the log instead of sending it.
 *
 * This is what makes the reset and verification flows testable end to end
 * without a mail or SMS account. It refuses to run in production, because
 * silently not sending a password-reset email is worse than failing loudly.
 */
export class ConsoleNotifier implements Notifier {
  readonly name = 'console';

  async send(message: OutboundMessage): Promise<void> {
    logger.info(
      { channel: message.channel, to: message.to, subject: message.subject },
      `[${this.name}] ${message.body}`
    );
  }
}

/**
 * Placeholder for a real provider.
 *
 * Kept so the production path is explicit rather than implied: deploying with
 * no transport configured fails when sending; deployments must wire a real transport.
 */
export class UnconfiguredNotifier implements Notifier {
  readonly name = 'unconfigured';

  async send(message: OutboundMessage): Promise<void> {
    logger.error(
      { channel: message.channel, to: message.to },
      'No notification transport is configured; message was not sent'
    );
    throw new Error(
      'No notification transport configured. Set up an email/SMS provider before enabling this in production.'
    );
  }
}

function createNotifier(): Notifier {
  // In production a real transport must be wired up here. Until one exists,
  // UnconfiguredNotifier makes the omission loud rather than silent.
  if (isProduction) return new UnconfiguredNotifier();
  return new ConsoleNotifier();
}

export const notifier: Notifier = createNotifier();

/**
 * Whether the API may echo a freshly issued code back in its response.
 *
 * True only outside production, so the web and mobile clients (and the test
 * suite) can complete a reset flow without a mail server. This is the single
 * gate on that behaviour — never read NODE_ENV for it at a call site.
 */
export const canRevealOtpInResponse = !isProduction && env.NODE_ENV !== 'production';
