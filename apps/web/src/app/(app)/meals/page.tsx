import type { Metadata } from 'next';
import type { CatalogFacets, CatalogMeal, DeliverySlotOption } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireUser } from '@/lib/session';
import { CatalogFilters } from '@/components/catalog/CatalogFilters';
import { MealCard } from '@/components/catalog/MealCard';
import { SearchBox } from '@/components/catalog/SearchBox';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Browse meals' };

type SearchParams = Record<string, string | string[] | undefined>;

/** Rebuilds the API query from the page's own URL, preserving repeats. */
function toApiQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  const passthrough = [
    'serviceDate',
    'checkpointId',
    'mealPeriod',
    'timeSlotId',
    'foodType',
    'categoryId',
    'search',
    'minPrice',
    'maxPrice',
    'sort',
    'page',
  ];

  for (const key of passthrough) {
    const value = params[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }

  // Allergen exclusions repeat, so they cannot go through the loop above.
  const excluded = params['excludeAllergens'];
  if (typeof excluded === 'string') query.append('excludeAllergens', excluded);
  else if (Array.isArray(excluded)) for (const a of excluded) query.append('excludeAllergens', a);

  query.set('pageSize', '24');
  return query.toString();
}

export default async function MealsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser('/meals');
  const params = await searchParams;
  const requestedCheckpointId = typeof params['checkpointId'] === 'string' ? params['checkpointId'] : '';
  const institutionId = typeof params['institutionId'] === 'string' ? params['institutionId'] : '';
  const [{ dates }, { checkpoints }, { institutions }] = await Promise.all([
    apiServer.get<{ dates: string[] }>(
      `/catalog/dates${requestedCheckpointId ? `?checkpointId=${requestedCheckpointId}` : ''}`
    ),
    apiServer.get<{ checkpoints: { id: string; name: string }[] }>('/reference/checkpoints'+(institutionId?'?institutionId='+encodeURIComponent(institutionId):'')),
    apiServer.get<{institutions:{id:string;name:string}[]}>('/reference/institutions'),
  ]);
  const checkpointId = checkpoints.some((checkpoint) => checkpoint.id === requestedCheckpointId)
    ? requestedCheckpointId
    : '';
  const requestedDate = typeof params['serviceDate'] === 'string' ? params['serviceDate'] : '';
  const serviceDate = dates.includes(requestedDate) ? requestedDate : dates[0] ?? '';
  const deliverySlots =
    checkpointId && serviceDate
      ? await apiServer.get<{ slots: DeliverySlotOption[] }>(
          `/catalog/delivery-slots?${new URLSearchParams({ checkpointId, serviceDate })}`
        ).then(({ slots }) => slots).catch(() => [])
      : [];
  const requestedTimeSlotId = typeof params['timeSlotId'] === 'string' ? params['timeSlotId'] : '';
  const selectedSlot = deliverySlots.find(
    (slot) => slot.timeSlotId === requestedTimeSlotId && slot.orderable
  );
  const canBrowse = Boolean(checkpointId && serviceDate && selectedSlot);
  const catalog = canBrowse
    ? await apiServer.getWithMeta<CatalogMeal[], { facets: CatalogFacets; total: number }>(
        `/catalog/meals?${toApiQuery({ ...params, checkpointId, serviceDate, timeSlotId: requestedTimeSlotId })}`
      )
    : {
        data: [],
        meta: {
          total: 0,
          facets: { mealPeriods: [], foodTypes: [], categories: [], priceRange: null },
        },
      };

  const meals = catalog.data;
  const firstName = user.fullName.split(' ')[0] ?? user.fullName;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Browse meals, {firstName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
            Choose a delivery date, checkpoint, and available time before browsing meals.
        </p>
      </div>

      <SearchBox />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside>
          <CatalogFilters institutions={institutions}
            facets={catalog.meta.facets}
            dates={dates}
            checkpoints={checkpoints}
            deliverySlots={deliverySlots}
          />
        </aside>

        <section>
          <p className="mb-3 text-sm text-slate-500">
            {canBrowse
              ? `${catalog.meta.total} ${catalog.meta.total === 1 ? 'meal' : 'meals'} available`
              : 'Choose a date, checkpoint, and available time slot to continue.'}
          </p>

          {meals.length === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              description="Try another date or checkpoint, or clear a filter — kitchens publish different dishes on different days."
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {meals.map((meal) => (
                <MealCard key={meal.mealScheduleId} meal={meal} checkpointId={checkpointId} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
