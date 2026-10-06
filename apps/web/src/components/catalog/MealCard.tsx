import Link from 'next/link';
import { ALLERGEN_LABELS, FOOD_TYPE_LABELS, formatCurrency, type CatalogMeal } from '@lunch/shared';

const FOOD_TYPE_DOT: Record<string, string> = {
  VEG: 'bg-green-600',
  VEGAN: 'bg-green-600',
  JAIN: 'bg-green-600',
  EGG: 'bg-amber-500',
  NON_VEG: 'bg-red-600',
};

/**
 * One purchasable meal.
 *
 * Allergens are shown on the card rather than hidden behind the detail view:
 * a parent scanning a list for their child should not have to open six dishes
 * to find out which contain peanuts.
 */
export function MealCard({ meal, checkpointId }: { meal: CatalogMeal; checkpointId?: string }) {
  const href = `/meals/${meal.mealScheduleId}${checkpointId ? `?checkpointId=${checkpointId}` : ''}`;
  const lowStock = meal.remaining <= 5;

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-brand-300 hover:shadow-sm">
      <Link href={href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
        {meal.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meal.imageUrl}
            alt=""
            className="h-36 w-full bg-slate-100 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-36 w-full items-center justify-center bg-slate-100 text-sm text-slate-400">
            No photo
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">{meal.name}</h3>
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${FOOD_TYPE_DOT[meal.foodType] ?? 'bg-slate-400'}`}
              title={FOOD_TYPE_LABELS[meal.foodType] ?? meal.foodType}
              aria-label={FOOD_TYPE_LABELS[meal.foodType] ?? meal.foodType}
            />
          </div>

          <p className="mt-0.5 text-sm text-slate-500">
            {meal.timeSlot.label} · {meal.vendor.businessName}
          </p>

          {meal.description && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-600">{meal.description}</p>
          )}

          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold text-slate-900">
              {formatCurrency(meal.price)}
            </span>
            {meal.nutrition.calories !== null && (
              <span className="text-xs text-slate-500">{meal.nutrition.calories} kcal</span>
            )}
          </div>

          {meal.allergens.length > 0 && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              Contains {meal.allergens.map((a) => ALLERGEN_LABELS[a] ?? a).join(', ')}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {!meal.orderable && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                Ordering closed
              </span>
            )}
            {meal.orderable && lowStock && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                Only {meal.remaining} left
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
