export interface SubscriptionView {
  id: string; plan: string; status: string; startDate: string; endDate: string | null; quantity: number; pricePerMeal: string; daysOfWeek: number[];
  meal: { name: string }; child: { fullName: string } | null; checkpoint: { name: string }; timeSlot: { label: string; startMinute: number };
}
export interface SubscriptionDetail extends SubscriptionView {
  upcoming: MealOccurrence[]; history: MealOccurrence[];
  events: { id: string; action: string; serviceDate: string | null; createdAt: string }[];
  skips: { id: string; serviceDate: string }[];
}
export interface MealOccurrence { id: string; serviceDate: string; status: string; beneficiaryName: string; mealNameSnapshot: string; order: { id: string; orderNumber: string } }
export const planLabels: Record<string,string> = { ONE_TIME: 'One-time', DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', WEEKDAYS: 'Monday–Friday', CUSTOM: 'Custom days' };
