import { SubscribeForm } from '@/components/subscriptions/SubscribeForm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ALLERGEN_LABELS,
  FOOD_TYPE_LABELS,
  MEAL_PERIOD_LABELS,
  formatCurrency,
  type CatalogMealDetail,
  type Child,
} from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireUser } from '@/lib/session';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { AddToCartForm } from '@/components/catalog/AddToCartForm';

export const metadata: Metadata = { title: 'Meal details' };

export default async function MealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ mealScheduleId: string }>;
  searchParams: Promise<{ checkpointId?: string; serviceDate?: string; timeSlotId?: string }>;
}) {
  const user = await requireUser();
  const { mealScheduleId } = await params;
  const { checkpointId, serviceDate, timeSlotId } = await searchParams;

  let meal: CatalogMealDetail;
  let children: Child[] = [];
  try {
    const query = checkpointId ? `?checkpointId=${checkpointId}` : '';
    ({ meal } = await apiServer.get<{ meal: CatalogMealDetail }>(
      `/catalog/meals/${mealScheduleId}${query}`
    ));
  } catch (err) {
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  }

  if (user.role === 'PARENT' || user.role === 'CUSTOMER') {
    ({ children } = await apiServer.get<{ children: Child[] }>('/children'));
  }

  const backParams = new URLSearchParams();
  if (serviceDate) backParams.set('serviceDate', serviceDate);
  if (checkpointId) backParams.set('checkpointId', checkpointId);
  if (timeSlotId) backParams.set('timeSlotId', timeSlotId);
  const backHref = `/meals${backParams.size ? `?${backParams.toString()}` : ''}`;
  const nutrition = [
    { label: 'Calories', value: meal.nutrition.calories, unit: 'kcal' },
    { label: 'Protein', value: meal.nutrition.proteinG, unit: 'g' },
    { label: 'Carbs', value: meal.nutrition.carbsG, unit: 'g' },
    { label: 'Fat', value: meal.nutrition.fatG, unit: 'g' },
    { label: 'Fibre', value: meal.nutrition.fibreG, unit: 'g' },
  ].filter((n) => n.value !== null);

  return (
    <div className="space-y-6">
      <Link href={backHref} className="text-sm font-medium text-brand-600 hover:text-brand-700">
        ← Browse meals
      </Link>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          {meal.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={meal.imageUrl}
              alt=""
              className="aspect-[4/3] w-full rounded-lg bg-slate-100 object-cover"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">
              No photo
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{meal.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {meal.vendor.businessName} · {meal.kitchen.name}
            </p>
            {meal.description && <p className="mt-3 text-slate-700">{meal.description}</p>}
          </div>

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="text-3xl font-semibold text-slate-900">
              {formatCurrency(meal.price)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {FOOD_TYPE_LABELS[meal.foodType] ?? meal.foodType}
            </span>
            {meal.mealPeriods.map((period) => (
              <span
                key={period}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
              >
                {MEAL_PERIOD_LABELS[period] ?? period}
              </span>
            ))}
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <div>
              <dt className="text-slate-500">Delivery</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{meal.timeSlot.label}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Date</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {new Date(`${meal.serviceDate}T00:00:00Z`).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Preparation</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{meal.prepTimeMinutes} min</dd>
            </div>
            <div>
              <dt className="text-slate-500">Left today</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{meal.remaining}</dd>
            </div>
          </dl>

          {meal.allergens.length > 0 ? (
            <Alert tone="warning" title="Allergens declared">
              Contains {meal.allergens.map((a) => ALLERGEN_LABELS[a] ?? a).join(', ')}. Check with
              the kitchen if an allergy is severe.
            </Alert>
          ) : (
            <Alert tone="info" title="No allergens declared">
              This kitchen has not declared any of the major allergens for this dish. That is not a
              guarantee of absence — ask the kitchen if an allergy is severe.
            </Alert>
          )}

          {meal.orderable && checkpointId && <SubscribeForm mealScheduleId={meal.mealScheduleId} checkpointId={checkpointId} children={children} serviceDate={meal.serviceDate} />}
          {meal.orderable && checkpointId ? (
            <AddToCartForm
              mealScheduleId={meal.mealScheduleId}
              checkpointId={checkpointId}
              children={children}
            />
          ) : (
            <Button size="lg" disabled className="w-full">
              {meal.orderable ? 'Choose a checkpoint to order' : 'Ordering closed'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {meal.components.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">What’s in the box</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
              {meal.components.map((c) => (
                <li key={c.name} className="flex justify-between gap-3">
                  <span>{c.name}</span>
                  {c.quantity && <span className="text-slate-500">{c.quantity}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {meal.ingredients.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Ingredients</h2>
            <p className="mt-3 text-sm capitalize text-slate-700">
              {meal.ingredients.join(', ')}
            </p>
          </section>
        )}

        {nutrition.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Nutrition per serving</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {nutrition.map((n) => (
                <div key={n.label} className="flex justify-between gap-3">
                  <dt className="text-slate-600">{n.label}</dt>
                  <dd className="font-medium tabular-nums text-slate-900">
                    {n.value} {n.unit}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {meal.alsoAvailableIn.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900">
            Also available on this date
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {meal.alsoAvailableIn.map((alt) => (
              <li key={alt.mealScheduleId}>
                <Link
                  href={`/meals/${alt.mealScheduleId}${checkpointId ? `?checkpointId=${checkpointId}` : ''}`}
                  className="inline-flex rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50"
                >
                  {alt.timeSlotLabel} · {formatCurrency(alt.price)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
