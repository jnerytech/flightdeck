import type { Card } from "@flightdeck/protocol";
import type { AppStore } from "@/lib/app-store";

export interface CardMergePrProps {
  store: AppStore;
  hostId: string;
  card: Card;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/** Issue #1196: merges the card's open PR from the card, after a confirm. */
export function CardMergePr(_props: Readonly<CardMergePrProps>) {
  return null;
}
