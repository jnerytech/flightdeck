import type { RiskLevel } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { HoldButton } from "./hold-button.tsx";

/** How long the Approve of a high-risk request has to be held (phase 13). */
export const HIGH_RISK_HOLD_MS = 2000;

/**
 * How a waiting request is answered, the same on every screen (issue #182): Approve, then Deny.
 * A high-risk request is approved only by holding the button, never by a click. `pending` keeps
 * both off while an answer is on its way.
 */
export function ApprovalActions(props: {
  risk?: RiskLevel | undefined;
  pending?: boolean;
  size?: "sm";
  /** A plan to approve says so ("Approve the plan" / "Keep planning"). */
  labels?: { approve: string; deny: string };
  holdMs?: number;
  onApprove(): unknown;
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
          onHeld={() => void props.onApprove()}
        />
      ) : (
        <ActionButton {...size} pending={pending} onClick={() => props.onApprove()}>
          {props.labels?.approve ?? t("approval.approve")}
        </ActionButton>
      )}
      <Button {...size} variant="outline" disabled={pending} onClick={() => void props.onDeny()}>
        {props.labels?.deny ?? t("approval.deny")}
      </Button>
    </>
  );
}
