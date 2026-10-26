import { z } from 'zod';
const money = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/,
    'Enter a non-negative amount with up to two decimal places',
  );
const id = z.string().min(1).max(100);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
export const corporateMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const corporateQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  month: corporateMonth.optional(),
  date: date.optional(),
  checkpointId: id.optional(),
  search: z.string().trim().max(100).optional(),
});
export const createCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    cityId: id,
    billingEmail: z.string().email().max(200),
  })
  .strict();
export const corporatePolicySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    monthlyBudget: money,
    employeeMonthlyCredit: money,
    subsidyPerMeal: money,
    maxMealsPerDay: z.number().int().min(1).max(10),
    allowedWeekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    allowedPeriods: z
      .array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS']))
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    allowCopayment: z.boolean(),
    billingEmail: z.string().email().max(200),
  })
  .strict();
export const approveCompanySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    creditLimit: money,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const corporateEmployeeSchema = z
  .object({
    email: z.string().email().max(200),
    employeeNumber: z.string().trim().max(100).nullable(),
    monthlyCredit: money.nullable(),
    role: z.enum(['ADMIN', 'EMPLOYEE']).default('EMPLOYEE'),
  })
  .strict();
export const corporateEmployeeUpdateSchema = z
  .object({
    isActive: z.boolean(),
    monthlyCredit: money.nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const corporateOfficeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    instructions: z.string().trim().max(1000).nullable(),
    deliveryCapacity: z.number().int().min(1).max(100000),
    timeSlotIds: z
      .array(id)
      .min(1)
      .max(20)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
const line = z
  .object({
    memberId: id,
    mealScheduleId: id,
    checkpointId: id,
    quantity: z.number().int().min(1).max(10),
  })
  .strict();
export const corporateOrderSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    maxEmployeeAmount: money,
    lines: z
      .array(line)
      .min(1)
      .max(50)
      .refine(
        (v) => new Set(v.map((x) => x.memberId)).size === v.length,
        'Choose each employee only once per batch',
      ),
  })
  .strict();
export const corporateInvoiceSchema = z
  .object({ month: corporateMonth })
  .strict();
export const corporateSettlementSchema = z
  .object({
    amount: money,
    reference: z.string().trim().min(4).max(120),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type CorporatePolicyInput = z.infer<typeof corporatePolicySchema>;
export type CorporateOrderInput = z.infer<typeof corporateOrderSchema>;
export interface CorporateSummary {
  id: string;
  name: string;
  status: string;
  currency: string;
  role: string;
  memberId: string | null;
  cityId: string;
  timezone: string;
}
export interface CorporateDetail extends CorporateSummary {
  billingEmail?: string;
  revision: number;
  monthlyBudget?: string;
  employeeMonthlyCredit: string;
  subsidyPerMeal: string;
  creditLimit?: string;
  maxMealsPerDay: number;
  allowedWeekdays: number[];
  allowedPeriods: string[];
  allowCopayment: boolean;
}
export interface CorporateEmployee {
  id: string;
  userId: string;
  role: string;
  isActive: boolean;
  employeeNumber: string | null;
  monthlyCredit: string | null;
  user: { fullName: string; email: string | null };
}
export interface CorporateUsage {
  month: string;
  companyAmount: string;
  employeeAmount: string;
  meals: number;
  orders: number;
  remainingCredit: string;
  remainingBudget?: string;
  outstanding?: string;
}
export interface CorporateOrderRow {
  id: string;
  orderId: string;
  memberId: string;
  month: string;
  quantity: number;
  companyAmount: string;
  employeeAmount: string;
  status: string;
  serviceDate: string;
  order: {
    orderNumber: string;
    status: string;
    items: {
      mealNameSnapshot: string;
      beneficiaryName: string;
      status: string;
      checkpoint: { name: string };
    }[];
  };
}
export interface CorporateInvoiceRow {
  id: string;
  number: string;
  month: string;
  amount: string;
  currency: string;
  issuedAt: string;
  settledAt: string | null;
  settlementReference: string | null;
  snapshot: Record<string, unknown>;
}
