import type { NotificationEvent } from '@lunch/shared';
export type TemplateData = {
  orderNumber?: string;
  beneficiary?: string;
  checkpoint?: string;
  meal?: string;
  endDate?: string;
  reason?: string;
};
export const TEMPLATE_VERSION = 1;
export function renderTemplate(event: NotificationEvent, data: TemplateData) {
  const beneficiary = data.beneficiary ?? 'Your';
  const meal = data.meal ?? 'meal';
  const subject = data.beneficiary
    ? `${beneficiary}'s ${meal}`
    : `Your ${meal}`;
  const location = data.checkpoint ?? 'your checkpoint';
  const order = data.orderNumber ?? 'your order';
  const templates: Record<NotificationEvent, { title: string; body: string }> =
    {
      'account.created': {
        title: 'Welcome to Lunch',
        body: 'Your account is ready. You can now order meals and manage your delivery preferences.',
      },
      'order.confirmed': {
        title: 'Order confirmed',
        body: `Order ${order} is confirmed.`,
      },
      'payment.successful': {
        title: 'Payment successful',
        body: `Payment for order ${order} was verified successfully.`,
      },
      'payment.failed': {
        title: 'Payment failed',
        body: `Payment for order ${order} failed. Open your order to check its payment status before retrying.`,
      },
      'meal.preparing': {
        title: 'Meal preparing',
        body: `${subject} is being prepared.`,
      },
      'meal.packed': {
        title: 'Meal packed',
        body: `${subject} is packed and ready for pickup.`,
      },
      'delivery.assigned': {
        title: 'Delivery partner assigned',
        body: `A delivery partner has been assigned for ${subject} at ${location}.`,
      },
      'delivery.started': {
        title: 'Delivery started',
        body: `${subject} is on the way to ${location}.`,
      },
      'delivery.arriving': {
        title: 'Delivery arriving',
        body: `Your delivery partner has arrived at ${location} with ${subject}.`,
      },
      'delivery.delivered': {
        title: 'Meal delivered',
        body: `${subject} was delivered at ${location}.`,
      },
      'delivery.late': {
        title: 'Meal delivery delayed',
        body: `${subject} has not been delivered within the scheduled window at ${location}. Open tracking for the latest verified status.`,
      },
      'checkpoint.changed': {
        title: 'Checkpoint schedule changed',
        body: data.reason ? `${subject}: ${data.reason}` : `${subject} is now scheduled at ${location}. Open your order for the updated delivery details.`,
      },
      'delivery.failed': {
        title: 'Delivery unsuccessful',
        body: `We could not deliver ${subject} at ${location}. Open your order or contact support for help.`,
      },
      'subscription.renewal': {
        title: 'Subscription renewal reminder',
        body: `Your meal plan ends on ${data.endDate ?? 'its scheduled end date'}. Open your subscriptions to plan your next meals. You have not been charged automatically.`,
      },
      'subscription.paused': {
        title: 'Subscription paused',
        body: 'Your meal subscription is paused. Resume it from your subscriptions when you are ready.',
      },
    };
  return templates[event];
}
