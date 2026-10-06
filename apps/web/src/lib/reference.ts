/**
 * Reference data shared by the profile and child forms.
 *
 * This module is imported by **client** components, so it must stay free of
 * server-only imports. The fetching lives in `reference.server.ts`; the data is
 * loaded in a server component and passed down as props, which also means a
 * form renders with its selects already populated.
 */

export interface RefOption {
  id: string;
  name: string;
}

export interface FormReferenceData {
  institutions: RefOption[];
  checkpoints: RefOption[];
  timeSlots: RefOption[];
  cities: RefOption[];
}

/** Turns reference options into `<SelectField>` options with a blank first entry. */
export function toSelectOptions(
  options: RefOption[],
  placeholder: string
): { value: string; label: string }[] {
  return [
    { value: '', label: placeholder },
    ...options.map((o) => ({ value: o.id, label: o.name })),
  ];
}

export const DIETARY_OPTIONS = [
  { value: 'NONE', label: 'No restriction' },
  { value: 'VEGETARIAN', label: 'Vegetarian' },
  { value: 'VEGAN', label: 'Vegan' },
  { value: 'EGGETARIAN', label: 'Eggetarian' },
  { value: 'JAIN', label: 'Jain' },
];
