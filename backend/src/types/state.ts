/**
 * Item state model — the hardest state problem in the brief, represented
 * explicitly on every editable item in a kit.
 *
 *   generated   — produced by the pipeline, untouched by the user
 *   edited      — user has modified this specific item (tagged "edited")
 *   pinned      — user wants this item protected; a pinned item is always
 *                 highlighted at the top of its list and never touched by
 *                 regeneration of its section
 *   user_added  — created by hand; survives regeneration like a pinned item
 *
 * A pinned item is treated as user-owned for regeneration purposes even if it
 * was originally generated. State is stored under the `meta` key of each item.
 */
export type ItemOrigin = 'generated' | 'user_added';

export type ItemFlags = {
  origin: ItemOrigin;
  edited: boolean;
  pinned: boolean;
};

export type Stateful<T> = T & { meta: ItemFlags };

export function generatedState(origin: ItemOrigin = 'generated'): ItemFlags {
  return { origin, edited: false, pinned: false };
}

export function userAddedState(): ItemFlags {
  return { origin: 'user_added', edited: false, pinned: false };
}

export function markEdited<T extends { meta?: ItemFlags }>(item: T, patch: Partial<T>): Stateful<T> {
  return {
    ...item,
    ...patch,
    meta: {
      origin: item.meta?.origin ?? 'generated',
      edited: true,
      pinned: item.meta?.pinned ?? false,
    },
  };
}

export function isUserOwned(item: ItemFlags | undefined | null): boolean {
  if (!item) return false;
  return item.pinned || item.origin === 'user_added';
}
