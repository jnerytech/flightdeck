import type { PlainInfo } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";

/** A permission request as a yes/no question with its consequence (simple mode, phase 33). */
export function QuestionCard(_props: {
  plain: PlainInfo;
  t: T;
  /** The host is locked to simple: no way to full mode. */
  locked: boolean;
  onAnswer(decision: "allow" | "deny"): void;
  onOpenFull(): void;
  onCopy(text: string): void;
  /** How long the yes of a high-risk question is held; two seconds. */
  holdMs?: number;
}) {
  return null;
}
