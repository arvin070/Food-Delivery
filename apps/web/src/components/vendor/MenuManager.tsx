'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createMealSchema, updateMealSchema, type VendorMeal } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import {
  blankToNull,
  blankToUndefined,
  parseTags,
  parseWithSchema,
  toFormErrors,
  type FieldErrors,
} from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { FormSection } from '@/components/forms/FormSection';
import { EmptyState } from '@/components/ui/States';
import { MenuList } from './MenuList';

const FOOD_TYPES = [
  { value: 'VEG', label: 'Vegetarian' },
  { value: 'NON_VEG', label: 'Non-vegetarian' },
  { value: 'EGG', label: 'Contains egg' },
  { value: 'VEGAN', label: 'Vegan' },
  { value: 'JAIN', label: 'Jain' },
];

/**
 * Menu screen: list plus an inline add/edit panel.
 *
 * The form is inline rather than a separate route because a vendor adding six
 * dishes in a row should not navigate back and forth each time.
 */
export function MenuManager({
  meals,
  categories,
  readOnly,
}: {
  meals: VendorMeal[];
  categories: { id: string; name: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<VendorMeal | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const open = adding || editing !== null;

  function close() {
    setAdding(false);
    setEditing(null);
    setFieldErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const f = new FormData(event.currentTarget);

    // Components arrive as parallel name/quantity inputs; pair them up and drop
    // any row the vendor left blank.
    const componentNames = f.getAll('componentName').map(String);
    const componentQuantities = f.getAll('componentQuantity').map(String);
    const components = componentNames
      .map((name, i) => ({ name: name.trim(), quantity: componentQuantities[i]?.trim() || null }))
      .filter((c) => c.name.length > 0);

    const raw = {
      name: String(f.get('name') ?? '').trim(),
      description: blankToNull(f.get('description')),
      basePrice: String(f.get('basePrice') ?? '').trim(),
      foodType: blankToUndefined(f.get('foodType')) ?? 'VEG',
      categoryId: blankToNull(f.get('categoryId')),
      cuisine: blankToNull(f.get('cuisine')),
      calories: blankToNull(f.get('calories')),
      tags: parseTags(f.get('tags')),
      prepTimeMinutes: String(f.get('prepTimeMinutes') ?? '45'),
      components,
    };

    const parsed = parseWithSchema(editing ? updateMealSchema : createMealSchema, raw);
    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      return;
    }

    setSaving(true);
    try {
      if (editing) await apiClient.patch(`/v1/vendor/meals/${editing.id}`, parsed.data);
      else await apiClient.post('/v1/vendor/meals', parsed.data);
      close();
      router.refresh();
    } catch (err) {
      const { fields, formError: message } = toFormErrors(err);
      setFieldErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  // Always render a few blank component rows so there is something to type into.
  const componentRows = editing
    ? [...editing.components, { name: '', quantity: '' }, { name: '', quantity: '' }]
    : Array.from({ length: 4 }, () => ({ name: '', quantity: '' }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {meals.length} {meals.length === 1 ? 'dish' : 'dishes'} on your menu
        </p>
        {!readOnly && !open && <Button onClick={() => setAdding(true)}>Add a dish</Button>}
      </div>

      {open && (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-6 rounded-lg border-2 border-brand-200 bg-brand-50/30 p-1"
        >
          <div className="space-y-6 p-4">
            <h2 className="text-base font-semibold text-slate-900">
              {editing ? `Edit ${editing.name}` : 'Add a dish'}
            </h2>

            {formError && <Alert tone="error">{formError}</Alert>}

            <FormSection title="Details">
              <TextField
                label="Dish name"
                name="name"
                defaultValue={editing?.name ?? ''}
                autoFocus
                required
                error={fieldErrors['name']}
              />
              <TextField
                label="Price"
                name="basePrice"
                inputMode="decimal"
                placeholder="149.00"
                defaultValue={editing?.basePrice ?? ''}
                required
                error={fieldErrors['basePrice']}
              />
              <TextField
                label="Description"
                name="description"
                defaultValue={editing?.description ?? ''}
                error={fieldErrors['description']}
              />
              <SelectField
                label="Food type"
                name="foodType"
                defaultValue={editing?.foodType ?? 'VEG'}
                options={FOOD_TYPES}
                error={fieldErrors['foodType']}
              />
              <SelectField
                label="Category"
                name="categoryId"
                defaultValue={editing?.category?.id ?? ''}
                options={[
                  { value: '', label: 'No category' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
                error={fieldErrors['categoryId']}
              />
              <TextField
                label="Cuisine"
                name="cuisine"
                defaultValue={editing?.cuisine ?? ''}
                placeholder="South Indian"
                error={fieldErrors['cuisine']}
              />
              <TextField
                label="Calories"
                name="calories"
                type="number"
                min={0}
                defaultValue={editing?.calories ?? ''}
                error={fieldErrors['calories']}
              />
              <TextField
                label="Preparation time (minutes)"
                name="prepTimeMinutes"
                type="number"
                min={1}
                defaultValue={editing?.prepTimeMinutes ?? 45}
                error={fieldErrors['prepTimeMinutes']}
              />
              <TextField
                label="Tags"
                name="tags"
                defaultValue={editing?.tags.join(', ') ?? ''}
                placeholder="thali, rice, veg"
                error={fieldErrors['tags']}
                hint="Comma separated. Used for search."
              />
            </FormSection>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900">What’s in the box</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Shown to the customer. Leave a row blank to skip it.
                </p>
              </div>
              <ul className="space-y-3">
                {componentRows.map((component, i) => (
                  <li key={i} className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label={`Item ${i + 1}`}
                      name="componentName"
                      defaultValue={component.name}
                      placeholder="Steamed rice"
                    />
                    <TextField
                      label={`Quantity ${i + 1}`}
                      name="componentQuantity"
                      defaultValue={component.quantity ?? ''}
                      placeholder="1 cup"
                    />
                  </li>
                ))}
              </ul>
            </section>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add dish'}
              </Button>
            </div>
          </div>
        </form>
      )}

      {meals.length === 0 && !open ? (
        <EmptyState
          title="No dishes yet"
          description="Add your first dish, then publish it for the dates you want to sell it."
          action={!readOnly ? <Button onClick={() => setAdding(true)}>Add a dish</Button> : undefined}
        />
      ) : (
        <MenuList
          meals={meals}
          readOnly={readOnly}
          onEdit={(meal) => {
            setAdding(false);
            setEditing(meal);
          }}
        />
      )}
    </div>
  );
}
