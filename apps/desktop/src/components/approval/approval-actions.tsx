import type { RiskLevel } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { HIGH_RISK_HOLD_MS } from "../../lib/hold.ts";
import { HoldButton } from "./hold-button.tsx";

export { HIGH_RISK_HOLD_MS };

/**
 * How a waiting request is answered, the same on every screen (issue #182): Approve, then Deny.
 * A high-risk request is approved only by holding the button, never by a click. `pending` keeps
 * both off while an answer is on its way.
 */
export function ApprovalActions(props: {
  /**
   * Required, so each caller says it (#245): a forgotten risk used to mean one click. `undefined`
   * is a request the daemon judged no risk for (an older daemon) or a gate, which has none.
   */
  risk: RiskLevel | undefined;
  pending?: boolean;
  size?: "sm";
  /** A plan to approve says so ("Approve the plan" / "Keep planning"). */
  labels?: { approve: string; deny: string };
  holdMs?: number;
  /** `held`: the Approve was held its full time, the proof the store asks of a high risk (#245). */
  onApprove(held: boolean): unknown;
  onDeny(): unknown;
}) {
  const t = useT();
  const pending = props.pending ?? false;
  const size = props.size ? { size: props.size } : {};
  return (
    <>
      {props.risk === "high" ? (
        <HoldButton
          label={t("approval.hold")}
          hint={t("approval.holdHint")}
          holdMs={props.holdMs ?? HIGH_RISK_HOLD_MS}
          disabled={pending}
          onHeld={() => void props.onApprove(true)}
        />
      ) : (
        <ActionButton {...size} pending={pending} onClick={() => props.onApprove(false)}>
          {props.labels?.approve ?? t("approval.approve")}
        </ActionButton>
      )}
      <Button {...size} variant="outline" disabled={pending} onClick={() => void props.onDeny()}>
        {props.labels?.deny ?? t("approval.deny")}
      </Button>
    </>
  );
}
