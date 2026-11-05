import { useState } from "react";

interface Draft<T> {
  value: T;
  /** Set once saved: the source as it was then. The next change of the source is the host's answer. */
  savedOver?: { source: T };
}

/**
 * A field's value that follows `source` (a prop, the store) until the person edits it (issue
 * #226). The edit then wins. `saved(sent)` hands the field back to the source, but only once the
 * source moves: until the host's update arrives the field keeps what was saved instead of flashing
 * the old value. A field seeded once from a prop kept the old value when the prop changed, and a
 * save sent that old value back.
 */
export function useDraft<T>(
  source: T,
): [value: T, edit: (value: T) => void, saved: (sent: T) => void] {
  const [draft, setDraft] = useState<Draft<T> | null>(null);
  const moved = draft?.savedOver !== undefined && !Object.is(draft.savedOver.source, source);
  // The source moved since the save: it leads again (React's "adjust state while rendering").
  if (moved) setDraft(null);
  return [
    draft && !moved ? draft.value : source,
    (value) => setDraft({ value }),
    // Only the edit that was sent: a newer one typed while the save was on its way stays a draft.
    (sent) =>
      setDraft((current) =>
        current && Object.is(current.value, sent) ? { ...current, savedOver: { source } } : current,
      ),
  ];
}
