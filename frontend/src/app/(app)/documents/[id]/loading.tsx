/*
 * Route-specific skeleton. The generic (app) one models a list page, which would
 * relayout badly here — the document view is a two-column detail page, and it is
 * also the slowest route (two query waves plus a signed-URL round trip), so it
 * is the one that most needs an honest placeholder.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-[fade_0.2s_var(--ease-smooth)_both]">
      <div className="skeleton h-4 w-24" />

      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="w-full">
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton mt-3 h-5 w-44" />
          <div className="skeleton mt-3 h-4 w-full max-w-sm" />
        </div>
        <div className="skeleton h-9 w-28 shrink-0" />
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-6">
          {[6, 5].map((rows, c) => (
            <div key={c} className="card p-5">
              <div className="skeleton h-5 w-36" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: rows }).map((_, i) => (
                  <div key={i} className="skeleton h-3.5" style={{ width: `${94 - i * 9}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          {[5, 3, 4].map((rows, c) => (
            <div key={c} className="card p-5">
              <div className="skeleton h-5 w-28" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: rows }).map((_, i) => (
                  <div key={i} className="skeleton h-3" style={{ width: `${88 - i * 11}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
