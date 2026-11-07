import type { Key, T } from "./index.ts";
import { ptBR } from "./pt-BR.ts";

/** The kinds of secret a host named, in the app's language: ids it does not know stay as they are. */
export function secretKindsText(t: T, kinds: string): string {
  return kinds
    .split(", ")
    .map((kind) => (kind in ptBR.secretKind ? t(`secretKind.${kind}` as Key) : kind))
    .join(", ");
}
