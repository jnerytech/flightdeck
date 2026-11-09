import type { Card, ChangesResult } from "@flightdeck/protocol";
import type { AppStore } from "@/lib/app-store";

/** Asks a second Claude call to read the card's diff and leave its findings as reviewer drafts. */
export function CardSecondOpinion(
  _props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    changes: ChangesResult;
    /** The reviewer drafts are on the host now: the Changes panel reads its comments again. */
    onReviewed(): void | Promise<void>;
  }>,
) {
  return null;
}
