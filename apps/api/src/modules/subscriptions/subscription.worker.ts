import { generateBatch } from './subscription.service';
import { logger } from '../../core/logger';
/** One bounded batch every minute. No overlapping work in this process; DB
 * constraints and serializable retries also permit multiple API replicas. */
export function startSubscriptionWorker() {
  let cursor = '';
  let stopped = false;
  let running: Promise<void> | undefined;
  const tick = () => {
    if (stopped || running) return;
    running = generateBatch(cursor).then(batch => { cursor = batch.nextCursor ?? ''; })
      .catch(error => { logger.error({ err: error }, 'Subscription worker failed'); })
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
