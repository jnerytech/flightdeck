import { createContext, useContext } from "react";

export interface FieldRowSlot {
  /** Shows the reason of the button whose help line is `id`, or removes it with `null`. */
  setReason(id: string, reason: string | null): void;
}

/**
 * What a button inside a `FieldRow` finds: where to say why it is disabled. A leaf file, so the
 * action button (shared/feedback) and the form (shared/layout) share it without importing each
 * other's entry.
 */
export const FieldRowContext = createContext<FieldRowSlot | null>(null);
export const useFieldRow = () => useContext(FieldRowContext);
