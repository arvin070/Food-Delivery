'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHECKPOINT_TYPE_LABELS, type CheckpointSummary } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

interface Props {
  /** The checkpoint currently saved as default. */
  defaultCheckpointId?: string | null;
  /** If set, saving updates the child's default rather than the user's. */
  childId?: string;
  /** Called after a checkpoint is saved as default. */
  onSaved?: (checkpoint: CheckpointSummary) => void;
}

/**
 * Customer-facing checkpoint picker.
 *
 * Searches active checkpoints, previews the selection, then lets the user save
 * it as their default (or their child's default). Designed to slot inside the
 * profile page, the child form, or a future checkout flow.
 */
export function CheckpointPicker({ defaultCheckpointId, childId, onSaved }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CheckpointSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CheckpointSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(defaultCheckpointId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = new URLSearchParams({ q: query.trim(), pageSize: '20', isActive: 'true' });
        const res = await apiClient.get<CheckpointSummary[]>(`/v1/checkpoints?${qs}`);
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function saveDefault() {
    if (!selected) return;
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const qs = childId ? `?childId=${childId}` : '';
      await apiClient.post(`/v1/checkpoints/${selected.id}/default${qs}`);
      setSavedId(selected.id);
      setSaved(true);
      onSaved?.(selected);
    } catch (err) {
      const { formError } = toFormErrors(err);
      setError(formError ?? 'Could not save your default checkpoint.');
    } finally {
      setSaving(false);
    }
  }

  const typeLabel = (type: string) => CHECKPOINT_TYPE_LABELS[type as keyof typeof CHECKPOINT_TYPE_LABELS] ?? type;

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div>
        <label className="block text-sm font-medium text-slate-900" htmlFor="checkpoint-search">
          Search checkpoints
        </label>
        <div className="relative mt-1.5">
          <input
            id="checkpoint-search"
            type="search"
            placeholder="School name, area, or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="block w-full rounded-md border-0 py-2 pl-3 pr-10 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 sm:text-sm"
          />
          {searching && (
            <span className="absolute right-3 top-2.5 text-xs text-slate-400">Searching…</span>
          )}
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {results.map((cp) => {
            const isSavedDefault = cp.id === savedId;
            const isSelected = cp.id === selected?.id;
            return (
              <li key={cp.id}>
                <button
                  type="button"
                  onClick={() => setSelected(cp)}
                  className={[
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50',
                    isSelected ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-slate-300">
                    {isSelected && (
                      <span className="h-2 w-2 rounded-full bg-brand-600" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {cp.name}
                      {isSavedDefault && (
                        <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
                          Your default
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {typeLabel(cp.type)}
                      {cp.institutionName ? ` · ${cp.institutionName}` : ''}
                      {` · ${cp.cityName}`}
                    </span>
                    {cp.addressLabel && (
                      <span className="block truncate text-xs text-slate-500">
                        {cp.addressLabel}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {query.trim() && !searching && results.length === 0 && (
        <p className="text-sm text-slate-500">No checkpoints found for &ldquo;{query}&rdquo;.</p>
      )}

      {/* Selected preview + save action */}
      {selected && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-900">Selected checkpoint</p>
          <p className="mt-1 text-sm text-slate-700">{selected.name}</p>
          <p className="text-xs text-slate-500">
            {typeLabel(selected.type)}
            {selected.institutionName ? ` · ${selected.institutionName}` : ''}
            {` · ${selected.cityName}`}
          </p>
          {selected.addressLabel && (
            <p className="mt-1 text-xs text-slate-500">{selected.addressLabel}</p>
          )}

          {error && (
            <div className="mt-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          {saved && (
            <p className="mt-2 text-sm text-green-700">
              ✓ Saved as your default checkpoint
              {childId ? ' for this child' : ''}.
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <Button size="sm" loading={saving} onClick={saveDefault}>
              {saving ? 'Saving…' : 'Set as default'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(null);
                setSaved(false);
                setError(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
