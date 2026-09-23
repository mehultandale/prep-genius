'use client';

import type { ItemMeta } from '@/types/kit';

/**
 * Explicit state representation in the UI:
 *  - "generated" and "regenerated" are two different tags (regenerated items
 *    carry an id prefix from the regeneration run, detected by the caller).
 *  - "edited" gets its own tag.
 *  - "pinned" is highlighted by the caller (pinned items sort to the top).
 */
export function StateTags({ meta, regenerated = false }: { meta?: ItemMeta; regenerated?: boolean }) {
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {meta.pinned && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Pinned
        </span>
      )}
      {meta.origin === 'user_added' && (
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
          Added
        </span>
      )}
      {meta.edited && (
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
          Edited
        </span>
      )}
      {!meta.edited && meta.origin === 'generated' && regenerated && (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
          Regenerated
        </span>
      )}
      {!meta.edited && meta.origin === 'generated' && !regenerated && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Generated
        </span>
      )}
    </span>
  );
}

export function PinnedBanner({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      📌 <strong>{count}</strong> pinned {label} {count === 1 ? 'is' : 'are'} kept at the top and protected
      from regeneration.
    </div>
  );
}
