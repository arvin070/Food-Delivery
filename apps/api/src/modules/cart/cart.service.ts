import type { Prisma } from '@prisma/client';
import {
  MealScheduleStatus,
  VendorStatus,
  type AddCartItemInput,
  type CartItemView,
  type CartView,
  type UpdateCartItemInput,
} from '@lunch/shared';
import { badRequest, notFound } from '../../core/errors';
import { toMoney } from '../../core/http';
import { prisma } from '../../core/prisma';

const cartSelect = {
  id: true,
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      mealScheduleId: true,
      quantity: true,
      notes: true,
      mealSchedule: {
        select: {
          id: true,
          serviceDate: true,
          price: true,
          totalQuantity: true,
          reservedQuantity: true,
          status: true,
          timeSlot: { select: { id: true, label: true, startMinute: true, orderCutoffMinutes: true, isActive: true } },
          meal: { select: { name: true, imageUrl: true, isActive: true, deletedAt: true } },
          kitchen: {
            select: {
              id: true,
              name: true,
              isActive: true,
              deletedAt: true,
              vendor: { select: { status: true, isActive: true, deletedAt: true } },
            },
          },
        },
      },
      checkpoint: { select: { id: true, name: true, isActive: true } },
      child: { select: { id: true, fullName: true, isActive: true, deletedAt: true } },
    },
  },
} satisfies Prisma.CartSelect;

type CartRow = Prisma.CartGetPayload<{ select: typeof cartSelect }>;

function utcToday(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function isBeforeCutoff(date: Date, startMinute: number, cutoffMinutes: number): boolean {
  const slotStart = new Date(date);
  slotStart.setUTCMinutes(slotStart.getUTCMinutes() + startMinute);
  return Date.now() < slotStart.getTime() - cutoffMinutes * 60_000;
}

function toCartItem(item: CartRow['items'][number]): CartItemView {
  const schedule = item.mealSchedule;
  const date = schedule.serviceDate;
  const remaining = Math.max(0, schedule.totalQuantity - schedule.reservedQuantity);
  const orderable =
    schedule.status === MealScheduleStatus.PUBLISHED &&
    item.checkpoint.isActive &&
    schedule.timeSlot.isActive &&
    schedule.meal.isActive &&
    schedule.meal.deletedAt === null &&
    schedule.kitchen.isActive &&
    schedule.kitchen.deletedAt === null &&
    schedule.kitchen.vendor.status === VendorStatus.APPROVED &&
    schedule.kitchen.vendor.isActive &&
    schedule.kitchen.vendor.deletedAt === null &&
    date >= utcToday() &&
    isBeforeCutoff(date, schedule.timeSlot.startMinute, schedule.timeSlot.orderCutoffMinutes) &&
    remaining >= item.quantity &&
    (!item.child || (item.child.isActive && item.child.deletedAt === null));
  const unitPrice = toMoney(schedule.price);

  return {
    id: item.id,
    mealScheduleId: schedule.id,
    mealName: schedule.meal.name,
    imageUrl: schedule.meal.imageUrl,
    quantity: item.quantity,
    unitPrice,
    lineTotal: (Number(unitPrice) * item.quantity).toFixed(2),
    serviceDate: date.toISOString().slice(0, 10),
    checkpoint: { id: item.checkpoint.id, name: item.checkpoint.name },
    timeSlot: { id: schedule.timeSlot.id, label: schedule.timeSlot.label },
    kitchen: { id: schedule.kitchen.id, name: schedule.kitchen.name },
    beneficiary: { id: item.child?.id ?? null, name: item.child?.fullName ?? 'Me' },
    remaining,
    orderable,
    notes: item.notes,
  };
}

function toCart(row: CartRow): CartView {
  const items = row.items.map(toCartItem);
  const subtotalCents = items.reduce(
    (total, item) => total + Math.round(Number(item.unitPrice) * 100) * item.quantity,
    0
  );
  return {
    id: row.id,
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    subtotal: (subtotalCents / 100).toFixed(2),
  };
}

async function ensureCart(userId: string): Promise<string> {
  const cart = await prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true },
  });
  return cart.id;
}

export async function getCart(userId: string): Promise<CartView> {
  const cartId = await ensureCart(userId);
  const row = await prisma.cart.findUniqueOrThrow({ where: { id: cartId }, select: cartSelect });
  return toCart(row);
}

async function validateAdd(
  tx: Prisma.TransactionClient,
  userId: string,
  input: AddCartItemInput
): Promise<{ schedule: { id: string; serviceDate: Date; timeSlotId: string; price: Prisma.Decimal } }> {
  const schedule = await tx.mealSchedule.findFirst({
    where: {
      id: input.mealScheduleId,
      status: MealScheduleStatus.PUBLISHED,
      meal: { isActive: true, deletedAt: null },
      kitchen: {
        isActive: true,
        deletedAt: null,
        vendor: { status: VendorStatus.APPROVED, isActive: true, deletedAt: null },
      },
      timeSlot: { isActive: true },
    },
    select: {
      id: true,
      serviceDate: true,
      price: true,
      totalQuantity: true,
      reservedQuantity: true,
      timeSlotId: true,
      timeSlot: { select: { startMinute: true, orderCutoffMinutes: true } },
      kitchen: { select: { id: true } },
    },
  });
  if (!schedule) throw badRequest('This meal is no longer available', { mealScheduleId: ['Choose an available meal'] });

  const checkpoint = await tx.checkpoint.findFirst({
    where: { id: input.checkpointId, isActive: true },
    select: { id: true },
  });
  if (!checkpoint) throw badRequest('Checkpoint is not available', { checkpointId: ['Choose an active checkpoint'] });

  const [window, serviceArea] = await Promise.all([
    tx.checkpointTimeSlot.findFirst({
      where: {
        checkpointId: checkpoint.id,
        timeSlotId: schedule.timeSlotId,
        isActive: true,
        timeSlot: { isActive: true },
      },
      select: { id: true },
    }),
    tx.kitchenServiceArea.findFirst({
      where: { kitchenId: schedule.kitchen.id, checkpointId: checkpoint.id, isActive: true },
      select: { id: true },
    }),
  ]);
  if (!window) throw badRequest('This time is not available at the checkpoint', { checkpointId: ['Choose another checkpoint or time'] });
  if (!serviceArea) throw badRequest('This kitchen does not serve the selected checkpoint', { checkpointId: ['Choose another checkpoint'] });

  if (schedule.serviceDate < utcToday()) {
    throw badRequest('Delivery date has passed', { mealScheduleId: ['Choose a future delivery'] });
  }
  if (!isBeforeCutoff(schedule.serviceDate, schedule.timeSlot.startMinute, schedule.timeSlot.orderCutoffMinutes)) {
    throw badRequest('Ordering cutoff has passed', { mealScheduleId: ['Choose another delivery time'] });
  }
  if (schedule.totalQuantity - schedule.reservedQuantity < input.quantity) {
    throw badRequest('Not enough meal stock remains', { quantity: ['Reduce the quantity'] });
  }

  if (input.childId) {
    const child = await tx.child.findFirst({
      where: { id: input.childId, parentId: userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!child) throw notFound('Beneficiary');
  }

  return { schedule };
}

export async function addCartItem(userId: string, input: AddCartItemInput): Promise<CartView> {
  const cartId = await ensureCart(userId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "carts" WHERE id = ${cartId} FOR UPDATE`;
    const { schedule } = await validateAdd(tx, userId, input);
    const existing = await tx.cartItem.findFirst({
      where: {
        cartId,
        mealScheduleId: schedule.id,
        checkpointId: input.checkpointId,
        childId: input.childId ?? null,
      },
      select: { id: true, quantity: true },
    });
    const quantity = input.quantity + (existing?.quantity ?? 0);
    const currentStock = await tx.mealSchedule.findUniqueOrThrow({
      where: { id: schedule.id },
      select: { totalQuantity: true, reservedQuantity: true },
    });
    if (currentStock.totalQuantity - currentStock.reservedQuantity < quantity) {
      throw badRequest('Not enough meal stock remains', { quantity: ['Reduce the quantity'] });
    }
    if (existing) {
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity, notes: input.notes ?? null, timeSlotId: schedule.timeSlotId, serviceDate: schedule.serviceDate },
      });
    } else {
      await tx.cartItem.create({
        data: {
          cartId,
          mealScheduleId: schedule.id,
          timeSlotId: schedule.timeSlotId,
          serviceDate: schedule.serviceDate,
          checkpointId: input.checkpointId,
          childId: input.childId ?? null,
          quantity,
          unitPrice: schedule.price,
          notes: input.notes ?? null,
        },
      });
    }
  });
  return getCart(userId);
}

export async function updateCartItem(
  userId: string,
  cartItemId: string,
  input: UpdateCartItemInput
): Promise<CartView> {
  const cartId = await ensureCart(userId);
  const item = await prisma.cartItem.findFirst({
    where: { id: cartItemId, cartId },
    select: { id: true, mealScheduleId: true },
  });
  if (!item) throw notFound('Cart item');
  const schedule = await prisma.mealSchedule.findUnique({
    where: { id: item.mealScheduleId },
    select: { totalQuantity: true, reservedQuantity: true },
  });
  if (!schedule || schedule.totalQuantity - schedule.reservedQuantity < input.quantity) {
    throw badRequest('Not enough meal stock remains', { quantity: ['Reduce the quantity'] });
  }
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } });
  return getCart(userId);
}

export async function removeCartItem(userId: string, cartItemId: string): Promise<void> {
  const cartId = await ensureCart(userId);
  const result = await prisma.cartItem.deleteMany({ where: { id: cartItemId, cartId } });
  if (result.count === 0) throw notFound('Cart item');
}

export async function loadCartForCheckout(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<{ cartId: string }> {
  const cart = await tx.cart.findUnique({
    where: { userId },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (!cart || cart._count.items === 0) throw badRequest('Your cart is empty');
  return { cartId: cart.id };
}