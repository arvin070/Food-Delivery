/**
 * Domain enums — the single source of truth.
 *
 * These names and values are kept identical to the Prisma enums in
 * `apps/api/prisma/schema.prisma`. Both the API and the web app import from
 * here so a role or status is never spelled two different ways.
 */

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  PARENT: 'PARENT',
  STUDENT: 'STUDENT',
  VENDOR: 'VENDOR',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
  INSTITUTION_ADMIN: 'INSTITUTION_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Roles a visitor may self-register as. The rest are provisioned by an admin. */
export const SELF_SIGNUP_ROLES: readonly UserRole[] = [
  UserRole.CUSTOMER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** Roles that may administer the platform. */
export const ADMIN_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN];

/** Roles that place orders for themselves or a child. */
export const BUYER_ROLES: readonly UserRole[] = [
  UserRole.CUSTOMER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const InstitutionType = {
  SCHOOL: 'SCHOOL',
  COLLEGE: 'COLLEGE',
  CORPORATE: 'CORPORATE',
  COMMUNITY: 'COMMUNITY',
  OTHER: 'OTHER',
} as const;
export type InstitutionType = (typeof InstitutionType)[keyof typeof InstitutionType];

export const CheckpointType = {
  COLLEGE_GATE: 'COLLEGE_GATE',
  SCHOOL_GATE: 'SCHOOL_GATE',
  BUS_CHECKPOINT: 'BUS_CHECKPOINT',
  OFFICE_RECEPTION: 'OFFICE_RECEPTION',
  HOSTEL: 'HOSTEL',
  APARTMENT: 'APARTMENT',
  OTHER: 'OTHER',
} as const;
export type CheckpointType = (typeof CheckpointType)[keyof typeof CheckpointType];

export const MealPeriod = {
  BREAKFAST: 'BREAKFAST',
  LUNCH: 'LUNCH',
  SNACKS: 'SNACKS',
  DINNER: 'DINNER',
} as const;
export type MealPeriod = (typeof MealPeriod)[keyof typeof MealPeriod];

export const FoodType = {
  VEG: 'VEG',
  NON_VEG: 'NON_VEG',
  EGG: 'EGG',
  VEGAN: 'VEGAN',
  JAIN: 'JAIN',
} as const;
export type FoodType = (typeof FoodType)[keyof typeof FoodType];

/**
 * The major allergens. Kept as a fixed list rather than free text because this
 * is safety-critical on a platform that feeds children — see the Prisma enum
 * for the full reasoning.
 */
export const Allergen = {
  MILK: 'MILK',
  EGGS: 'EGGS',
  FISH: 'FISH',
  SHELLFISH: 'SHELLFISH',
  TREE_NUTS: 'TREE_NUTS',
  PEANUTS: 'PEANUTS',
  WHEAT_GLUTEN: 'WHEAT_GLUTEN',
  SOY: 'SOY',
  SESAME: 'SESAME',
  MUSTARD: 'MUSTARD',
  CELERY: 'CELERY',
  SULPHITES: 'SULPHITES',
} as const;
export type Allergen = (typeof Allergen)[keyof typeof Allergen];

/** Human labels for the allergen list. */
export const ALLERGEN_LABELS: Record<Allergen, string> = {
  MILK: 'Milk',
  EGGS: 'Eggs',
  FISH: 'Fish',
  SHELLFISH: 'Shellfish',
  TREE_NUTS: 'Tree nuts',
  PEANUTS: 'Peanuts',
  WHEAT_GLUTEN: 'Wheat / gluten',
  SOY: 'Soy',
  SESAME: 'Sesame',
  MUSTARD: 'Mustard',
  CELERY: 'Celery',
  SULPHITES: 'Sulphites',
};

export const MEAL_PERIOD_LABELS: Record<string, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  SNACKS: 'Snack',
  DINNER: 'Dinner',
};

export const FOOD_TYPE_LABELS: Record<string, string> = {
  VEG: 'Vegetarian',
  NON_VEG: 'Non-vegetarian',
  EGG: 'Contains egg',
  VEGAN: 'Vegan',
  JAIN: 'Jain',
};

export const VendorStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const MealScheduleStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  SOLD_OUT: 'SOLD_OUT',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type MealScheduleStatus = (typeof MealScheduleStatus)[keyof typeof MealScheduleStatus];

/** Roll-up status of a whole order. Derived from its items. */
export const OrderStatus = {
  DRAFT: 'DRAFT',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PARTIALLY_FULFILLED: 'PARTIALLY_FULFILLED',
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Fulfilment status of one meal, for one beneficiary, on one date, at one
 * checkpoint. This — not `OrderStatus` — is what the kitchen and the delivery
 * partner actually move through, because a single order may span several dates
 * and checkpoints.
 */
export const OrderItemStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  PACKED: 'PACKED',
  DISPATCHED: 'DISPATCHED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type OrderItemStatus = (typeof OrderItemStatus)[keyof typeof OrderItemStatus];

/** Terminal states — no further fulfilment transitions are allowed. */
export const TERMINAL_ORDER_ITEM_STATUSES: readonly OrderItemStatus[] = [
  OrderItemStatus.DELIVERED,
  OrderItemStatus.CANCELLED,
  OrderItemStatus.FAILED,
];

export const DeliveryRunStatus = {
  PLANNED: 'PLANNED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type DeliveryRunStatus = (typeof DeliveryRunStatus)[keyof typeof DeliveryRunStatus];

export const DeliveryStopStatus = {
  PENDING: 'PENDING',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
} as const;
export type DeliveryStopStatus = (typeof DeliveryStopStatus)[keyof typeof DeliveryStopStatus];

export const DeliveryStatus = {
  PENDING: 'PENDING',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const PaymentProviderName = {
  MOCK: 'MOCK',
  RAZORPAY: 'RAZORPAY',
  CASH: 'CASH',
  WALLET: 'WALLET',
} as const;
export type PaymentProviderName = (typeof PaymentProviderName)[keyof typeof PaymentProviderName];

export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const RefundStatus = {
  PENDING: 'PENDING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const DietaryPreference = {
  NONE: 'NONE',
  VEGETARIAN: 'VEGETARIAN',
  VEGAN: 'VEGAN',
  EGGETARIAN: 'EGGETARIAN',
  JAIN: 'JAIN',
} as const;
export type DietaryPreference = (typeof DietaryPreference)[keyof typeof DietaryPreference];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const OtpPurpose = {
  PHONE_VERIFICATION: 'PHONE_VERIFICATION',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
  LOGIN: 'LOGIN',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];
