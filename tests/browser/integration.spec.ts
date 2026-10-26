import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../apps/api/src/core/prisma';
import { NAV_BY_ROLE } from '../../apps/web/src/lib/navigation';

const password = 'Integration123!';
const origin = 'http://127.0.0.1:3107';
const timezone = new Date().getUTCHours() < 20 ? 'UTC' : 'Pacific/Honolulu';
const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
const date = `${parts.year}-${parts.month}-${parts.day}`;
const minute = Number(parts.hour) * 60 + Number(parts.minute) + 90;
const users: { id: string; email: string; role: string }[] = [];
let cityId: string, institutionId: string, checkpointId: string, slotId: string, kitchenId: string, mealId: string, scheduleId: string, partnerId: string;

test.beforeAll(async ({ request }) => {
  for (const role of ['PARENT', 'VENDOR', 'DELIVERY_PARTNER', 'SUPER_ADMIN']) {
    const email = `integration-${randomUUID()}@browser.lunch`;
    const r = await request.post('/api/v1/auth/register', { data: { fullName: 'Integration ' + role, email, password, role: 'PARENT' }, headers: { Origin: origin } });
    expect(r.status()).toBe(201);
    const id = (await r.json()).data.user.id;
    users.push({ id, email, role });
    await prisma.user.update({ where: { id }, data: { role: role as never } });
  }
  cityId = (await prisma.city.create({ data: { name: 'Browser city ' + randomUUID(), state: 'Test', timezone } })).id;
  institutionId = (await prisma.institution.create({ data: { name: 'Browser ABC College', type: 'COLLEGE', cityId } })).id;
  checkpointId = (await prisma.checkpoint.create({ data: { name: 'Browser Gate A', type: 'COLLEGE_GATE', cityId, institutionId, deliveryCapacity: 100 } })).id;
  slotId = (await prisma.timeSlot.create({ data: { cityId, label: 'Browser Lunch', mealPeriod: 'LUNCH', startMinute: minute, endMinute: minute + 30, orderCutoffMinutes: 0 } })).id;
  await prisma.checkpointTimeSlot.create({ data: { checkpointId, timeSlotId: slotId, maxOrders: 100 } });
  const vendor = await prisma.vendor.create({ data: { ownerUserId: users[1]!.id, businessName: 'Browser kitchen vendor', status: 'APPROVED' } });
  kitchenId = (await prisma.kitchen.create({ data: { vendorId: vendor.id, cityId, name: 'Browser Kitchen', capacityPerSlot: 100 } })).id;
  await prisma.kitchenServiceArea.create({ data: { kitchenId, checkpointId } });
  mealId = (await prisma.meal.create({ data: { vendorId: vendor.id, kitchenId, name: 'Browser Lunch Thali', slug: randomUUID(), basePrice: 150, foodType: 'VEG', mealPeriods: ['LUNCH'] } })).id;
  scheduleId = (await prisma.mealSchedule.create({ data: { mealId, kitchenId, timeSlotId: slotId, serviceDate: new Date(date), totalQuantity: 100, price: 150, status: 'PUBLISHED' } })).id;
  partnerId = (await prisma.deliveryPartner.create({ data: { userId: users[2]!.id, cityId, isAvailable: true } })).id;
});

test.afterAll(async () => {
  const ids = users.map(u => u.id);
  const payments = await prisma.payment.findMany({ where: { order: { customerId: { in: ids } } }, select: { id: true } });
  await prisma.mockProviderRefund.deleteMany({ where: { paymentId: { in: payments.map(p => 'mock_pay_' + p.id) } } });
  await prisma.mockProviderPayment.deleteMany({ where: { id: { in: payments.map(p => p.id) } } });
  await prisma.order.deleteMany({ where: { customerId: { in: ids } } });
  if (kitchenId) await prisma.deliveryRun.deleteMany({ where: { kitchenId } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (mealId) await prisma.meal.deleteMany({ where: { id: mealId } });
  if (kitchenId) await prisma.kitchen.deleteMany({ where: { id: kitchenId } });
  if (checkpointId) await prisma.checkpoint.deleteMany({ where: { id: checkpointId } });
  if (slotId) await prisma.timeSlot.deleteMany({ where: { id: slotId } });
  if (institutionId) await prisma.institution.deleteMany({ where: { id: institutionId } });
  if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.$disconnect();
});
async function login(page: Page, role: string, next: string) {
  await page.goto('/login?next=' + encodeURIComponent(next));
  await page.getByLabel('Email or phone').fill(users.find(u => u.role === role)!.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(origin + next);
}

test('parent checkout through kitchen, admin assignment and mobile rider OTP handoff', async ({ page, browser }) => {
  test.setTimeout(120000);
  const contexts: BrowserContext[] = [];
  async function persona(role: string, path: string, mobile = false) {
    const context = await browser.newContext({ baseURL: origin, ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
    contexts.push(context);
    const p = await context.newPage(); await login(p, role, path); return p;
  }
  try {
    await login(page, 'PARENT', '/children/new');
    await page.getByLabel('Full name', { exact: true }).fill('Rahul');
    await page.getByRole('button', { name: 'Add child', exact: true }).click();
    await expect(page).toHaveURL(/\/children$/);
    await page.goto('/meals');
    await page.getByLabel('Institution (optional)').selectOption(institutionId);
    await expect(page.getByLabel('Deliver to').locator('option', { hasText: 'Browser Gate A' })).toHaveCount(1);
    await page.getByLabel('Deliver to', { exact: true }).selectOption(checkpointId);
    await page.getByLabel('Delivery date', { exact: true }).selectOption(date);
    await expect(page.getByLabel('Delivery time')).toBeEnabled();
    await page.getByLabel('Delivery time').selectOption(slotId);
    await page.getByRole('link', { name: /Browser Lunch Thali/ }).click();
    await page.getByRole('combobox', { name: /^Beneficiary/ }).selectOption({ label: 'Rahul' });
    await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await page.getByRole('link', { name: 'View cart', exact: true }).click();
    // Let the backend commit checkout, then lose only its response at the browser.
    let dropped = false;
    await page.route('**/api/v1/orders/checkout', async route => {
      if (!dropped) { dropped = true; await route.fetch(); await route.abort(); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /connection|Checkout/i })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Retry checkout', exact: true }).click();
    await expect(page).toHaveURL(/\/orders\/[^/]+$/);
    const orderId = page.url().split('/').pop()!;
    expect(await prisma.order.count({ where: { customerId: users[0]!.id } })).toBe(1);
    await page.getByRole('button', { name: 'Pay securely' }).click();
    await page.getByRole('button', { name: 'Simulate success' }).click();
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    const vendor = await persona('VENDOR', '/kitchen');
    await vendor.getByRole('button', { name: /Start preparing/ }).click();
    await vendor.getByRole('button', { name: /Mark packed/ }).click();
    await expect(vendor.getByText(/0 confirmed · 0 preparing · 1 packed/)).toBeVisible();
    const admin = await persona('SUPER_ADMIN', '/admin/routes/new');
    await admin.getByLabel('Route name').fill('Browser college lunch route');
    await admin.getByRole('combobox', { name: /^Kitchen/ }).selectOption(kitchenId);
    await admin.getByLabel('Delivery date', { exact: true }).fill(date);
    await admin.getByRole('combobox', { name: /^Delivery partner/ }).selectOption(partnerId);
    await admin.getByRole('checkbox', { name: /Browser Gate A/ }).check();
    await admin.getByRole('button', { name: 'Create & assign route' }).click();
    await expect(admin).toHaveURL(/\/admin\/routes\/(?!new)[^/]+$/);
    const rider = await persona('DELIVERY_PARTNER', '/delivery', true);
    await rider.getByRole('button', { name: 'Confirm meal pickup' }).click();
    await rider.getByRole('button', { name: 'Start route', exact: true }).click();
    await rider.getByRole('link', { name: /Browser Gate A/ }).click();
    await rider.getByRole('button', { name: 'Arrive at checkpoint' }).click();
    await expect(rider.getByLabel('Receiver name')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Get delivery code' }).click();
    const code = await page.locator('[aria-live="polite"] p').filter({ hasText: /^\d{6}$/ }).innerText();
    await rider.getByLabel('Receiver name').fill('Rahul');
    await rider.getByLabel('Customer’s 6-digit delivery code').fill(code);
    await rider.getByRole('button', { name: 'Verify & mark delivered' }).click();
    await expect(rider.getByLabel('Receiver name')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
    await page.goto('/notifications');
    await expect(page.getByText("Rahul's Browser Lunch Thali was delivered at Browser Gate A.", { exact: true })).toBeVisible();
    await admin.goto('/admin/manage/orders/' + orderId);
    await expect(admin.getByText(/^delivered$/i).first()).toBeVisible();
    await vendor.goto(`/vendor/orders?range=date&serviceDate=${date}&status=DELIVERED`);
    await expect(vendor.getByText('Rahul', { exact: false }).first()).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});

// Every published role link must render a page, not redirect silently to another persona.
for (const role of ['PARENT', 'VENDOR', 'DELIVERY_PARTNER', 'SUPER_ADMIN'] as const) {
  test(`${role} navigation resolves all published links`, async ({ page }) => {
    test.setTimeout(90000);
    await login(page, role, '/profile');
    for (const link of NAV_BY_ROLE[role]) {
      const response = await page.goto(link.href);
      expect(response?.status(), link.href).toBe(200);
      await expect(page, link.href).toHaveURL(origin + link.href);
      await expect(page.getByRole('heading', { name: /something went wrong|page not found/i })).toHaveCount(0);
    }
  });
}
