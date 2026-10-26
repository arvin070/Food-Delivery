import { z } from 'zod';
import { idSchema } from '@lunch/shared';
export const createPaymentSchema = z.object({ orderId: idSchema }).strict();
export const verifyPaymentSchema = z.object({ providerPaymentId: z.string().regex(/^[a-zA-Z0-9_]+$/).max(100), signature: z.string().regex(/^[a-fA-F0-9]{64}$/) }).strict();
export const refundSchema = z.object({ idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{10,100}$/), amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(), reason: z.string().trim().min(1).max(200) }).strict();
export const simulationSchema = z.object({ status: z.enum(['captured','failed','cancelled','authorized']) }).strict();
