import { reconcilePayments } from './payment.service';
import { logger } from '../../core/logger';
export function startPaymentWorker() {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = reconcilePayments().catch(() => logger.warn('Payment reconciliation batch failed')).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, 60_000); timer.unref(); tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
