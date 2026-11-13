/** Whether a key press belongs to a field (its text), not to the list's shortcuts. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT";
}
