'use client';


export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body className="min-h-dvh p-6">
    <main className="mx-auto max-w-lg space-y-4 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-slate-600">The page could not be loaded. Your request has not been submitted again.</p>
      <button className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white" onClick={() => reset()}>Try again</button>
    </main>
  </body></html>;
}
