/** The value of the render where its JSON last changed (#1609), so an effect keyed on it needs no parse. */
export function useKeyed<T>(value: T): T {
  return value;
}
