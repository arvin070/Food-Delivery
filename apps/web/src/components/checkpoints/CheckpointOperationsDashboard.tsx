'use client';

export interface CheckpointOperationsData {
  generatedAt: string;
  checkpoints: Array<{
    id: string;
    name: string;
    type: string;
    active: boolean;
    meals: number;
    capacity: number | null;
    windows: Array<{ label: string; startMinute: number; meals: number; capacity: number | null; delayed: number; riders: string[] }>;
    unavailable: Array<{ startDate: string; endDate: string; timeSlotId: string | null; reason: string; replacementCheckpointName: string | null }>;
  }>;
}

function clock(minute: number) {
  return `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function CheckpointOperationsDashboard({ data }: { data: CheckpointOperationsData }) {
  const activeCount = data.checkpoints.filter(point => point.active).length;
  const mealCount = data.checkpoints.reduce((sum, point) => sum + point.meals, 0);
  const delayedCount = data.checkpoints.reduce((sum, point) => sum + point.windows.reduce((n, window) => n + window.delayed, 0), 0);
  const unavailableCount = data.checkpoints.reduce((sum, point) => sum + point.unavailable.length, 0);
  return <section className="space-y-4 border-y border-slate-200 py-5" aria-label="Checkpoint operations dashboard">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Checkpoint operations</h2>
        <p className="text-sm text-slate-500">Today’s booked checkpoints and upcoming availability</p></div>
      <time className="text-xs text-slate-500" dateTime={data.generatedAt}>Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</time>
    </header>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Active checkpoints", activeCount], ["Today's meals", mealCount], ['Delayed deliveries', delayedCount], ['Unavailable windows', unavailableCount]].map(([label, value]) =>
        <div key={label} className="border-l-2 border-emerald-700 pl-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
    </dl>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead><tr className="border-b text-xs text-slate-500"><th className="py-2 pr-4 font-medium">Checkpoint</th><th className="py-2 pr-4 font-medium">Window / meals</th><th className="py-2 pr-4 font-medium">Capacity</th><th className="py-2 pr-4 font-medium">Riders</th><th className="py-2 pr-2 font-medium">Operations</th></tr></thead>
        <tbody>{data.checkpoints.map(point => <tr key={point.id} className="border-b border-slate-100 align-top">
          <td className="py-3 pr-4"><span className="font-medium">{point.name}</span><span className="ml-2 text-xs text-slate-500">{point.type.replaceAll('_', ' ').toLowerCase()}</span>{!point.active && <span className="ml-2 text-xs text-red-700">Inactive</span>}</td>
          <td className="py-3 pr-4">{point.windows.length ? point.windows.map(window => <div key={window.label}>{clock(window.startMinute)} · {window.meals} meals</div>) : <span className="text-slate-500">No active windows</span>}</td>
          <td className="py-3 pr-4">{point.windows.map(window => <div key={window.label}>{window.capacity === null ? 'No limit' : `${window.meals} / ${window.capacity}`}</div>)}</td>
          <td className="py-3 pr-4">{[...new Set(point.windows.flatMap(window => window.riders))].join(', ') || 'Unassigned'}</td>
          <td className="py-3 pr-2">{point.windows.some(window => window.delayed > 0) && <p className="font-medium text-amber-800">{point.windows.reduce((n, window) => n + window.delayed, 0)} delayed</p>}
            {point.unavailable.map((exception, index) => <p key={`${exception.startDate}-${index}`} className="text-xs text-red-700">{exception.startDate}–{exception.endDate}: {exception.replacementCheckpointName ? `moved to ${exception.replacementCheckpointName}` : exception.reason}</p>)}
            {!point.unavailable.length && !point.windows.some(window => window.delayed > 0) && <span className="text-slate-500">On schedule</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
