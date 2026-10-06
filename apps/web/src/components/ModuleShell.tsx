import type { PlannedSection } from '@/lib/navigation';
import { Alert } from '@/components/ui/Alert';

/**
 * The scaffold every role surface renders while its module is unbuilt.
 *
 * Shared so the role shells are one layout rather than six near-copies, and
 * honest about what will live there instead of imitating a finished screen.
 * Planned sections are described, not linked — their routes do not exist yet.
 */
export function ModuleShell({
  title,
  subtitle,
  moduleName,
  sections,
  children,
}: {
  title: string;
  subtitle: string;
  /** The module that will fill this screen, named in the notice. */
  moduleName: string;
  sections?: PlannedSection[];
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <Alert tone="info" title="Foundation only">
        This screen is a navigation placeholder — the {moduleName} fills it in.
      </Alert>

      {sections && sections.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900">Planned for this surface</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section) => (
              <li
                key={section.label}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-sm font-semibold text-slate-900">{section.label}</p>
                <p className="mt-1 text-sm text-slate-500">{section.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {children}
    </div>
  );
}
