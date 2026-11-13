import { useRef } from "react";

/**
 * The value of the render where its JSON last changed (#1609). A value rebuilt on every render keeps
 * one identity while its content is the same, so an effect that depends on it runs only on a change,
 * and needs no text key parsed back into the value. The value is the caller's own: do not mutate it.
 */
export function useKeyed<T>(value: T): T {
  const key = JSON.stringify(value);
  const kept = useRef({ key, value });
  if (kept.current.key !== key) kept.current = { key, value };
  return kept.current.value;
}
