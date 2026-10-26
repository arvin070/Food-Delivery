import { z } from "zod";
export const availabilitySchema = z
  .object({ isAvailable: z.boolean() })
  .strict();
export interface RiderDelivery {
  id: string;
  status: string;
  orderItemId: string;
  orderNumber: string;
  mealName: string;
  beneficiaryName: string;
  quantity: number;
  serviceDate: string;
  orderStatus: string;
  receiverName: string | null;
  failureReason: string | null;
  routeId: string | null;
  stopId: string | null;
  checkpoint: {
    id: string;
    name: string;
    instructions: string | null;
    addressLabel: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  timeSlot: { id: string; label: string };
  kitchen: { id: string; name: string };
}
export interface RiderRoute {
  id: string;
  status: string;
  serviceDate: string;
  startedAt: string | null;
  departedAt: string | null;
  kitchen: { id: string; name: string; timezone: string };
  timeSlot: { label: string; startMinute: number };
  timeSlots: {id:string;label:string;startMinute:number}[];
  deliveryCount: number;
  mealCount: number;
  completedCount: number;
  failedCount: number;
  stops: {
    id: string;
    sequence: number;
    status: string;
    checkpoint: { name: string; instructions: string | null; latitude?: number | null; longitude?: number | null };
    deliveryCount: number;
    mealCount: number;
  }[];
}
export interface RiderDashboard {
  partner: {
    id: string;
    isAvailable: boolean;
    vehicleType: string | null;
    vehicleNumber: string | null;
  };
  totals: {
    routes: number;
    deliveries: number;
    meals: number;
    delivered: number;
    failed: number;
  };
  routes: RiderRoute[];
  page: number;
  pageSize: number;
}
export interface RiderStopDetail {
  route: RiderRoute;
  stopId: string;
  deliveries: RiderDelivery[];
  total: number;
  page: number;
  pageSize: number;
}
