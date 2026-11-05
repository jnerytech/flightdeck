import { useState } from "react";

interface Draft<T> {
  value: T;
  /** The source the edit started from: once the source moves away from it, the edit is stale. */
  base: T;
  /** Set once saved: the source as it was then. The next change of the source is the host's answer. */
  savedOver?: { source: T };
}

/**
 * A field's value that follows `source` (a prop, the store) until the person edits it (issue
 * #226). The edit then wins. `saved(sent)` hands the field back to the source, but only once the
 * source moves: until the host's update arrives the field keeps what was saved instead of flashing
 * the old value. A field seeded once from a prop kept the old value when the prop changed, and a
 * save sent that old value back.
 *
 * `extra.stale` says the source moved elsewhere under an edit (#170, #249): a plain save would
 * write over that change. `extra.drop()` gives the edit up for the source ("Use theirs"). `saved`
 * takes what the host keeps of a sent value (`stored`, a trimmed title): an edit typed while the
 * save was on its way then starts from it.
 */
export function useDraft<T>(
  source: T,
): [
  value: T,
  edit: (value: T) => void,
  saved: (sent: T, stored?: T) => void,
  extra: { stale: boolean; drop: () => void },
] {
  const [draft, setDraft] = useState<Draft<T> | null>(null);
  const moved = draft?.savedOver !== undefined && !Object.is(draft.savedOver.source, source);
  // The source moved since the save: it leads again (React's "adjust state while rendering").
  if (moved) setDraft(null);
  const live = draft && !moved ? draft : null;
  const stale = live !== null && live.savedOver === undefined && !Object.is(live.base, source);
  return [
    live ? live.value : source,
    (value) => setDraft((current) => ({ value, base: current ? current.base : source })),
    // Only the edit that was sent: a newer one typed while the save was on its way stays a draft.
    (sent, stored = sent) =>
      setDraft((current) => {
        if (!current) return current;
        if (Object.is(current.value, sent)) {
          return { ...current, base: stored, savedOver: { source } };
        }
        return { value: current.value, base: stored };
      }),
    { stale, drop: () => setDraft(null) },
  ];
}
