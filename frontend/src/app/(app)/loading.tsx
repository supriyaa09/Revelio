/*
 * Streamed instantly on navigation, while the page's queries are still in
 * flight. Without it App Router holds the previous screen frozen until the
 * server render completes — several hundred milliseconds of nothing happening,
 * which reads as the app being slow rather than as work in progress.
 *
 * The shape deliberately mirrors the real list pages (title block, then a card
 * of rows) so the swap to real content is a fill-in rather than a relayout.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-[fade_0.2s_var(--ease-smooth)_both]">
      <div className="mb-7 flex items-end justify-between gap-6">
        <div className="w-full">
          <div className="skeleton h-9 w-52" />
          <div className="skeleton mt-3 h-4 w-full max-w-md" />
        </div>
        <div className="skeleton h-9 w-36 shrink-0" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <div className="card hidden h-fit flex-col gap-2 p-3 lg:flex">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton h-7" style={{ width: `${88 - i * 6}%` }} />
          ))}
        </div>

        <div>
          <div className="skeleton mb-3 h-5 w-40" />
          <div className="card divide-y divide-line overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3.5 px-4 py-3.5">
                <div className="skeleton size-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton h-4" style={{ width: `${58 - i * 4}%` }} />
                  <div className="skeleton mt-2 h-3" style={{ width: `${80 - i * 5}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
