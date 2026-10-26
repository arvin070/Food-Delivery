import { z } from 'zod';

export const trackingSessionSchema = z.object({ sessionId: z.string().uuid() }).strict();
export const riderLocationSchema = trackingSessionSchema.extend({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(1000),
  observedAt: z.string().datetime(),
}).strict();
export const riderEtaSchema = trackingSessionSchema.extend({
  stopId: z.string().cuid(),
  estimatedArrivalAt: z.string().datetime().nullable(),
}).strict();
export type RiderLocationInput = z.infer<typeof riderLocationSchema>;
export type RiderEtaInput = z.infer<typeof riderEtaSchema>;

export interface TrackedMeal {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  beneficiary: string;
  meal: string;
  quantity: number;
  status: string;
  deliveryStatus: string | null;
  checkpoint: { name: string; instructions: string | null; latitude: number | null; longitude: number | null };
  window: { start: string; end: string; timezone: string; label: string };
  timeline: { label: string; at: string }[];
  deliveredAt: string | null;
  verifiedAt: string | null;
  late: boolean;
  location: {
    state: 'LIVE' | 'STALE' | 'NOT_SHARING' | 'UNAVAILABLE' | 'COMPLETE';
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    observedAt: string | null;
    expiresAt: string | null;
  };
  eta: { at: string; reportedAt: string; expiresAt: string; source: 'RIDER' } | null;
}
export interface TrackingSnapshot {
  serverTime: string;
  meals: TrackedMeal[];
  page: number;
  hasMore: boolean;
}
