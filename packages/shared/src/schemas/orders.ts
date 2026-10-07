import { z } from 'zod';
import { DeliveryStatus, OrderItemStatus, OrderStatus, PaymentStatus } from '../enums/index.js';
import { idSchema, paginationSchema } from './common.js';

export const addCartItemSchema = z.object({
  mealScheduleId: idSchema,
  checkpointId: idSchema,
  childId: idSchema.nullish(),
  quantity: z.coerce.number().int().min(1).max(100),
  notes: z.string().trim().max(500).nullish(),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(100),
});
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

export const cartItemIdParamSchema = z.object({ cartItemId: idSchema });

export const checkoutSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderIdParamSchema = z.object({ orderId: idSchema });
export const deliveryPartnerIdParamSchema = z.object({ deliveryPartnerId: idSchema });
export const deliveryOrderItemIdParamSchema = z.object({ orderItemId: idSchema });
export const deliveryIdParamSchema = z.object({ deliveryId: idSchema });

export const assignDeliverySchema = z.object({ deliveryPartnerId: idSchema });

export const updateDeliveryStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(DeliveryStatus.OUT_FOR_DELIVERY) }),
  z.object({ status: z.literal(DeliveryStatus.AT_CHECKPOINT) }),
  z.object({
    status: z.literal(DeliveryStatus.DELIVERED),
    receiverName: z.string().trim().min(2).max(120),
  }),
  z.object({
    status: z.literal(DeliveryStatus.FAILED),
    failureReason: z.string().trim().min(3).max(500),
  }),
]);
export type UpdateDeliveryStatusInput = z.infer<typeof updateDeliveryStatusSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const listOrdersQuerySchema = paginationSchema.extend({
  status: z.enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]]).optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export interface CartItemView {
  id: string;
  mealScheduleId: string;
  mealName: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  serviceDate: string;
  checkpoint: { id: string; name: string };
  timeSlot: { id: string; label: string };
  kitchen: { id: string; name: string };
  beneficiary: { id: string | null; name: string };
  remaining: number;
  orderable: boolean;
  notes: string | null;
}

export interface CartView {
  id: string;
  items: CartItemView[];
  itemCount: number;
  subtotal: string;
}

export interface CustomerOrderItem {
  id: string;
  mealName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  beneficiaryName: string;
  serviceDate: string;
  checkpoint: { id: string; name: string };
  timeSlot: { id: string; label: string };
  kitchen: { id: string; name: string };
  status: OrderItemStatus;
  deliveryStatus: DeliveryStatus | null;
  notes: string | null;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  placedAt: string | null;
  cancelledAt: string | null;
  items: CustomerOrderItem[];
}