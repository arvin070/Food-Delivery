/**
 * Development seed.
 *
 * Creates one city with checkpoints and time slots, an approved vendor with a
 * kitchen and a published menu for the next 14 days, plus one user per role —
 * enough to exercise the whole Customer → Kitchen → Rider flow by hand.
 *
 * Idempotent: every write is an upsert keyed on a natural unique, so re-running
 * it refreshes data instead of duplicating it.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Same password for every seeded account — development only. */
const SEED_PASSWORD = 'Lunch@1234';

/** Midnight UTC for a date `offset` days from today, matching `@db.Date`. */
function serviceDate(offset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

async function upsertUser(data: {
  email: string;
  phone: string;
  fullName: string;
  role: Prisma.UserCreateInput['role'];
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { email: data.email },
    update: { fullName: data.fullName, role: data.role, status: 'ACTIVE' },
    create: {
      ...data,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      profile: { create: {} },
      wallet: { create: {} },
    },
  });
}

async function main() {
  console.log('Seeding…');
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ── City & zone ───────────────────────────────────────────────────────────
  const city = await prisma.city.upsert({
    where: { name_state: { name: 'Coimbatore', state: 'Tamil Nadu' } },
    update: { isActive: true },
    create: { name: 'Coimbatore', state: 'Tamil Nadu', timezone: 'Asia/Kolkata' },
  });

  const zone = await prisma.zone.upsert({
    where: { cityId_name: { cityId: city.id, name: 'Peelamedu' } },
    update: {},
    create: { cityId: city.id, name: 'Peelamedu' },
  });

  // ── Time slots ────────────────────────────────────────────────────────────
  // Cutoffs are deliberately generous so a seeded demo can order for tomorrow.
  const slotSpecs = [
    { label: 'Breakfast 08:00–08:30', mealPeriod: 'BREAKFAST' as const, startMinute: 480, endMinute: 510, orderCutoffMinutes: 720, sortOrder: 1 },
    { label: 'Lunch 12:30–13:00', mealPeriod: 'LUNCH' as const, startMinute: 750, endMinute: 780, orderCutoffMinutes: 600, sortOrder: 2 },
    { label: 'Snacks 16:00–16:30', mealPeriod: 'SNACKS' as const, startMinute: 960, endMinute: 990, orderCutoffMinutes: 480, sortOrder: 3 },
    { label: 'Dinner 19:30–20:00', mealPeriod: 'DINNER' as const, startMinute: 1170, endMinute: 1200, orderCutoffMinutes: 480, sortOrder: 4 },
  ];

  const timeSlots = [];
  for (const spec of slotSpecs) {
    const existing = await prisma.timeSlot.findFirst({
      where: { cityId: city.id, label: spec.label },
    });
    timeSlots.push(
      existing
        ? await prisma.timeSlot.update({ where: { id: existing.id }, data: spec })
        : await prisma.timeSlot.create({ data: { ...spec, cityId: city.id } })
    );
  }
  const lunchSlot = timeSlots.find((s) => s.mealPeriod === 'LUNCH')!;

  // ── Institutions ──────────────────────────────────────────────────────────
  const institutionSpecs = [
    { name: 'PSG College of Technology', type: 'COLLEGE' as const },
    { name: 'Suguna PIP School', type: 'SCHOOL' as const },
    { name: 'Robert Bosch — Coimbatore Office', type: 'CORPORATE' as const },
  ];
  const institutions = [];
  for (const spec of institutionSpecs) {
    const existing = await prisma.institution.findFirst({ where: { name: spec.name } });
    institutions.push(
      existing ?? (await prisma.institution.create({ data: { ...spec, cityId: city.id } }))
    );
  }
  const [college, school, office] = institutions;

  // ── Checkpoints ───────────────────────────────────────────────────────────
  const checkpointSpecs = [
    { name: 'PSG Tech — Main Gate', type: 'COLLEGE_GATE' as const, institutionId: college!.id, latitude: 11.0245, longitude: 77.0027, instructions: 'Left of the main gate, beside the security kiosk.' },
    { name: 'PSG Tech — Boys Hostel Block C', type: 'HOSTEL' as const, institutionId: college!.id, latitude: 11.0251, longitude: 77.0041, instructions: 'Hostel reception desk.' },
    { name: 'Suguna PIP School — Gate 2', type: 'SCHOOL_GATE' as const, institutionId: school!.id, latitude: 11.0518, longitude: 77.0112, instructions: 'Hand over to the duty teacher at Gate 2.' },
    { name: 'Bosch Office — Reception', type: 'OFFICE_RECEPTION' as const, institutionId: office!.id, latitude: 11.0301, longitude: 77.0289, instructions: 'Leave at the front desk; call on arrival.' },
    { name: 'Hope College Bus Stop', type: 'BUS_CHECKPOINT' as const, institutionId: null, latitude: 11.0276, longitude: 77.0192, instructions: 'Opposite the bus shelter.' },
    { name: 'Brookefields Residency', type: 'APARTMENT' as const, institutionId: null, latitude: 11.0068, longitude: 76.9704, instructions: 'Tower B security desk.' },
  ];

  const checkpoints = [];
  for (const spec of checkpointSpecs) {
    const existing = await prisma.checkpoint.findFirst({
      where: { name: spec.name, cityId: city.id },
    });
    checkpoints.push(
      existing ??
        (await prisma.checkpoint.create({ data: { ...spec, cityId: city.id, zoneId: zone.id } }))
    );
  }

  // Every checkpoint accepts every slot, with a per-checkpoint capacity.
  for (const checkpoint of checkpoints) {
    for (const slot of timeSlots) {
      await prisma.checkpointTimeSlot.upsert({
        where: { checkpointId_timeSlotId: { checkpointId: checkpoint.id, timeSlotId: slot.id } },
        update: {},
        create: { checkpointId: checkpoint.id, timeSlotId: slot.id, maxOrders: 120 },
      });
    }
  }

  // ── Users, one per role ───────────────────────────────────────────────────
  const admin = await upsertUser({
    email: 'admin@lunch.test', phone: '+919000000001',
    fullName: 'Platform Admin', role: 'SUPER_ADMIN', passwordHash,
  });
  const customer = await upsertUser({
    email: 'customer@lunch.test', phone: '+919000000002',
    fullName: 'Aravind Kumar', role: 'CUSTOMER', passwordHash,
  });
  const parent = await upsertUser({
    email: 'parent@lunch.test', phone: '+919000000003',
    fullName: 'Lakshmi Narayanan', role: 'PARENT', passwordHash,
  });
  const student = await upsertUser({
    email: 'student@lunch.test', phone: '+919000000004',
    fullName: 'Divya Raman', role: 'STUDENT', passwordHash,
  });
  const vendorUser = await upsertUser({
    email: 'vendor@lunch.test', phone: '+919000000005',
    fullName: 'Meena Tiffin Centre', role: 'VENDOR', passwordHash,
  });
  const riderUser = await upsertUser({
    email: 'rider@lunch.test', phone: '+919000000006',
    fullName: 'Suresh Babu', role: 'DELIVERY_PARTNER', passwordHash,
  });
  const institutionAdminUser = await upsertUser({
    email: 'institution@lunch.test', phone: '+919000000007',
    fullName: 'PSG Hostel Warden', role: 'INSTITUTION_ADMIN', passwordHash,
  });

  await prisma.institutionMember.upsert({
    where: { institutionId_userId: { institutionId: college!.id, userId: institutionAdminUser.id } },
    update: { role: 'ADMIN' },
    create: { institutionId: college!.id, userId: institutionAdminUser.id, role: 'ADMIN' },
  });

  // ── Children (the parent's two kids, at two different institutions) ───────
  const childSpecs = [
    { fullName: 'Arjun Narayanan', institutionId: school!.id, grade: 'Grade 7', section: 'B', defaultCheckpointId: checkpoints[2]!.id, dietaryPreference: 'VEGETARIAN' as const, allergies: 'Peanuts' },
    { fullName: 'Ananya Narayanan', institutionId: college!.id, grade: 'II B.Tech CSE', section: 'A', defaultCheckpointId: checkpoints[0]!.id, dietaryPreference: 'NONE' as const, allergies: null },
  ];
  for (const spec of childSpecs) {
    const existing = await prisma.child.findFirst({
      where: { parentId: parent.id, fullName: spec.fullName },
    });
    if (!existing) await prisma.child.create({ data: { ...spec, parentId: parent.id } });
  }

  // ── Vendor, kitchen, service areas ────────────────────────────────────────
  const vendor = await prisma.vendor.upsert({
    where: { ownerUserId: vendorUser.id },
    update: { status: 'APPROVED', isActive: true },
    create: {
      ownerUserId: vendorUser.id,
      businessName: 'Meena Tiffin Centre',
      legalName: 'Meena Foods Pvt Ltd',
      contactEmail: 'vendor@lunch.test',
      contactPhone: '+919000000005',
      status: 'APPROVED',
      approvedAt: new Date(),
      commissionPct: '15.00',
    },
  });

  let kitchen = await prisma.kitchen.findFirst({
    where: { vendorId: vendor.id, name: 'Peelamedu Central Kitchen' },
  });
  kitchen ??= await prisma.kitchen.create({
    data: {
      vendorId: vendor.id,
      name: 'Peelamedu Central Kitchen',
      cityId: city.id,
      zoneId: zone.id,
      capacityPerSlot: 250,
      contactPhone: '+919000000005',
      latitude: 11.0268,
      longitude: 77.0054,
    },
  });

  for (const checkpoint of checkpoints) {
    await prisma.kitchenServiceArea.upsert({
      where: { kitchenId_checkpointId: { kitchenId: kitchen.id, checkpointId: checkpoint.id } },
      update: { isActive: true },
      create: {
        kitchenId: kitchen.id,
        checkpointId: checkpoint.id,
        prepLeadMinutes: 90,
        travelMinutes: 25,
      },
    });
  }

  // ── Delivery partner ──────────────────────────────────────────────────────
  await prisma.deliveryPartner.upsert({
    where: { userId: riderUser.id },
    update: { isActive: true, isAvailable: true },
    create: {
      userId: riderUser.id,
      cityId: city.id,
      vehicleType: 'Two-wheeler',
      vehicleNumber: 'TN 37 CX 4521',
      licenceNumber: 'TN3720190004521',
    },
  });

  // ── Menu ──────────────────────────────────────────────────────────────────
  const categorySpecs = [
    { name: 'South Indian', slug: 'south-indian', sortOrder: 1 },
    { name: 'North Indian', slug: 'north-indian', sortOrder: 2 },
    { name: 'Tiffin Box', slug: 'tiffin-box', sortOrder: 3 },
    { name: 'Snacks', slug: 'snacks', sortOrder: 4 },
  ];
  const categories = [];
  for (const spec of categorySpecs) {
    categories.push(
      await prisma.mealCategory.upsert({ where: { slug: spec.slug }, update: spec, create: spec })
    );
  }
  const [southIndian, northIndian, tiffinBox, snacks] = categories;

  const mealSpecs = [
    {
      slug: 'south-indian-veg-thali', name: 'South Indian Veg Thali',
      description: 'Rice, sambar, two poriyals, rasam, curd, appalam and a sweet.',
      basePrice: '129.00', foodType: 'VEG' as const, categoryId: southIndian!.id,
      calories: 680, proteinG: '18.50', carbsG: '98.00', fatG: '19.20', fibreG: '8.40',
      cuisine: 'South Indian', tags: ['thali', 'rice', 'veg'],
      mealPeriods: ['LUNCH', 'DINNER'] as const,
      ingredients: ['rice', 'toor dal', 'tamarind', 'curry leaves', 'coconut', 'curd', 'jaggery'],
      allergens: ['MILK'] as const, prepTimeMinutes: 45, maxDailyQuantity: 120,
      components: [['Steamed rice', '1 cup'], ['Sambar', '150 ml'], ['Poriyal', '2 varieties'], ['Curd', '100 ml'], ['Sweet', '1 piece']],
    },
    {
      slug: 'chapati-paneer-tiffin', name: 'Chapati & Paneer Tiffin',
      description: 'Four chapatis with paneer butter masala and salad.',
      basePrice: '159.00', foodType: 'VEG' as const, categoryId: northIndian!.id,
      calories: 720, proteinG: '26.00', carbsG: '82.00', fatG: '28.50', fibreG: '9.10',
      cuisine: 'North Indian', tags: ['chapati', 'paneer'],
      mealPeriods: ['LUNCH', 'DINNER'] as const,
      ingredients: ['wheat flour', 'paneer', 'tomato', 'butter', 'cream', 'cashew'],
      allergens: ['MILK', 'WHEAT_GLUTEN', 'TREE_NUTS'] as const, prepTimeMinutes: 40, maxDailyQuantity: 100,
      components: [['Chapati', '4 nos'], ['Paneer butter masala', '200 ml'], ['Salad', '1 portion']],
    },
    {
      slug: 'school-kids-tiffin', name: 'School Kids Tiffin Box',
      description: 'Mini idlis, chutney, a fruit portion and a milk-based sweet. Made in a nut-free batch.',
      basePrice: '99.00', foodType: 'VEG' as const, categoryId: tiffinBox!.id,
      calories: 480, proteinG: '12.00', carbsG: '76.00', fatG: '11.00', fibreG: '5.20',
      cuisine: 'South Indian', tags: ['kids', 'nut-free', 'tiffin'],
      mealPeriods: ['BREAKFAST', 'LUNCH'] as const,
      ingredients: ['idli rice', 'urad dal', 'coconut', 'banana', 'milk', 'sugar'],
      allergens: ['MILK'] as const, prepTimeMinutes: 35, maxDailyQuantity: 200,
      components: [['Mini idli', '8 nos'], ['Chutney', '60 ml'], ['Fruit portion', '1 cup'], ['Sweet', '1 piece']],
    },
    {
      slug: 'chicken-biryani-box', name: 'Chicken Biryani Box',
      description: 'Seeraga samba biryani with raita and boiled egg.',
      basePrice: '199.00', foodType: 'NON_VEG' as const, categoryId: southIndian!.id,
      calories: 860, proteinG: '42.00', carbsG: '96.00', fatG: '31.00', fibreG: '4.80',
      cuisine: 'South Indian', tags: ['biryani', 'chicken'],
      mealPeriods: ['LUNCH', 'DINNER'] as const,
      ingredients: ['seeraga samba rice', 'chicken', 'yoghurt', 'mint', 'egg', 'ghee'],
      allergens: ['MILK', 'EGGS'] as const, prepTimeMinutes: 60, maxDailyQuantity: 80,
      components: [['Chicken biryani', '350 g'], ['Raita', '80 ml'], ['Boiled egg', '1 no']],
    },
    {
      slug: 'vegan-millet-bowl', name: 'Vegan Millet Bowl',
      description: 'Little-millet khichdi with sautéed vegetables and a peanut-free chutney.',
      basePrice: '149.00', foodType: 'VEGAN' as const, categoryId: tiffinBox!.id,
      calories: 520, proteinG: '15.00', carbsG: '84.00', fatG: '12.50', fibreG: '11.00',
      cuisine: 'Healthy', tags: ['vegan', 'millet', 'healthy'],
      mealPeriods: ['LUNCH', 'DINNER'] as const,
      ingredients: ['little millet', 'moong dal', 'carrot', 'beans', 'coconut oil'],
      allergens: [] as const, prepTimeMinutes: 40, maxDailyQuantity: 90,
      components: [['Millet khichdi', '1 bowl'], ['Sautéed vegetables', '150 g'], ['Chutney', '50 ml']],
    },
    {
      slug: 'evening-snack-combo', name: 'Evening Snack Combo',
      description: 'Two medu vadas, one sweet and filter coffee.',
      basePrice: '79.00', foodType: 'VEG' as const, categoryId: snacks!.id,
      calories: 390, proteinG: '9.00', carbsG: '52.00', fatG: '15.00', fibreG: '3.60',
      cuisine: 'South Indian', tags: ['snack', 'coffee'],
      mealPeriods: ['SNACKS'] as const,
      ingredients: ['urad dal', 'coffee', 'milk', 'sugar', 'ghee'],
      allergens: ['MILK'] as const, prepTimeMinutes: 25, maxDailyQuantity: 150,
      components: [['Medu vada', '2 nos'], ['Sweet', '1 piece'], ['Filter coffee', '150 ml']],
    },
  ];

  const meals = [];
  for (const spec of mealSpecs) {
    const { components, mealPeriods, allergens, ...mealData } = spec;
    const writable = {
      ...mealData,
      mealPeriods: [...mealPeriods],
      allergens: [...allergens],
    };
    const meal = await prisma.meal.upsert({
      where: { vendorId_slug: { vendorId: vendor.id, slug: spec.slug } },
      update: { ...writable, isActive: true },
      create: { ...writable, vendorId: vendor.id, kitchenId: kitchen.id },
    });
    await prisma.mealComponent.deleteMany({ where: { mealId: meal.id } });
    await prisma.mealComponent.createMany({
      data: components.map(([name, quantity], i) => ({
        mealId: meal.id,
        name: name!,
        quantity: quantity!,
        sortOrder: i,
      })),
    });
    meals.push(meal);
  }

  // ── Published schedules for the next 14 days ──────────────────────────────
  // Every meal is offered in the slots that suit it, so the browse screen has
  // real data for any date the user picks.
  const slotsForMeal = (slug: string) => {
    if (slug === 'evening-snack-combo') return timeSlots.filter((s) => s.mealPeriod === 'SNACKS');
    if (slug === 'school-kids-tiffin') return timeSlots.filter((s) => s.mealPeriod === 'LUNCH' || s.mealPeriod === 'BREAKFAST');
    return timeSlots.filter((s) => s.mealPeriod === 'LUNCH' || s.mealPeriod === 'DINNER');
  };

  let scheduleCount = 0;
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const date = serviceDate(dayOffset);
    for (const meal of meals) {
      for (const slot of slotsForMeal(meal.slug)) {
        await prisma.mealSchedule.upsert({
          where: {
            mealId_kitchenId_serviceDate_timeSlotId: {
              mealId: meal.id,
              kitchenId: kitchen.id,
              serviceDate: date,
              timeSlotId: slot.id,
            },
          },
          update: { status: 'PUBLISHED', totalQuantity: 60, price: meal.basePrice },
          create: {
            mealId: meal.id,
            kitchenId: kitchen.id,
            serviceDate: date,
            timeSlotId: slot.id,
            price: meal.basePrice,
            totalQuantity: 60,
            status: 'PUBLISHED',
          },
        });
        scheduleCount += 1;
      }
    }
  }

  // ── Operating hours: Mon–Sat 06:00–22:00, Sunday closed ──────────────────
  for (let day = 1; day <= 7; day += 1) {
    await prisma.kitchenOperatingHour.upsert({
      where: { kitchenId_dayOfWeek: { kitchenId: kitchen.id, dayOfWeek: day } },
      update: {},
      create: {
        kitchenId: kitchen.id,
        dayOfWeek: day,
        opensMinute: 360,
        closesMinute: 1320,
        isClosed: day === 7,
      },
    });
  }

  // ── Sample orders, so the vendor dashboard has something to show ─────────
  // Spread across today and the next two days, in a mix of statuses.
  const buyers = [customer, parent, student];
  const orderStatuses = ['PENDING', 'CONFIRMED', 'PREPARING', 'PACKED', 'DELIVERED'] as const;

  const existingOrders = await prisma.order.count({ where: { orderNumber: { startsWith: 'LN-SEED' } } });
  if (existingOrders === 0) {
    let seq = 0;
    for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
      const date = serviceDate(dayOffset);
      const schedules = await prisma.mealSchedule.findMany({
        where: { serviceDate: date, status: 'PUBLISHED' },
        include: { meal: true },
        take: 4,
      });

      for (const schedule of schedules) {
        const buyer = buyers[seq % buyers.length]!;
        const checkpoint = checkpoints[seq % checkpoints.length]!;
        // Today gets a spread of statuses; future dates stay CONFIRMED.
        const status = dayOffset === 0 ? orderStatuses[seq % orderStatuses.length]! : 'CONFIRMED';
        const quantity = (seq % 3) + 1;
        const unitPrice = schedule.price.toString();
        const lineTotal = (Number(unitPrice) * quantity).toFixed(2);

        const order = await prisma.order.create({
          data: {
            orderNumber: `LN-SEED${String(seq).padStart(4, '0')}`,
            customerId: buyer.id,
            cityId: city.id,
            status: 'CONFIRMED',
            subtotal: lineTotal,
            totalAmount: lineTotal,
            placedAt: new Date(),
          },
        });

        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            mealScheduleId: schedule.id,
            mealId: schedule.mealId,
            kitchenId: schedule.kitchenId,
            checkpointId: checkpoint.id,
            timeSlotId: schedule.timeSlotId,
            serviceDate: date,
            beneficiaryName: buyer.fullName,
            mealNameSnapshot: schedule.meal.name,
            unitPrice,
            quantity,
            lineTotal,
            status,
            ...(status === 'PREPARING' ? { preparingAt: new Date() } : {}),
            ...(status === 'PACKED' ? { packedAt: new Date() } : {}),
          },
        });

        await prisma.mealSchedule.update({
          where: { id: schedule.id },
          data: { reservedQuantity: { increment: quantity } },
        });

        seq += 1;
      }
    }
    console.log(`  Seeded ${seq} sample orders across 3 days.`);
  }

  console.log(`
Seed complete.

  City            ${city.name}, ${city.state}
  Institutions    ${institutions.length}
  Checkpoints     ${checkpoints.length}
  Time slots      ${timeSlots.length}   (lunch slot: ${lunchSlot.label})
  Meals           ${meals.length}
  Schedules       ${scheduleCount}  (next 14 days, PUBLISHED)

Sign in with password: ${SEED_PASSWORD}

  SUPER_ADMIN         ${admin.email}
  CUSTOMER            ${customer.email}
  PARENT              ${parent.email}   (2 children)
  STUDENT             ${student.email}
  VENDOR              ${vendorUser.email}
  DELIVERY_PARTNER    ${riderUser.email}
  INSTITUTION_ADMIN   ${institutionAdminUser.email}
`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
