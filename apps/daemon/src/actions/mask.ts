/** Stub. */
export interface MaskedSecret {
  name: string;
  value: string;
}

/** Stub. */
export function maskOutput(text: string, _secrets: readonly MaskedSecret[]): string {
  return text;
}
