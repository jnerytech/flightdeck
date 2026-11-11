import type { ReviewComment } from "@flightdeck/protocol";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";

/** A finding's severity in words (never colour alone); a blocker or a high one reads as a warning. */
export function FindingSeverity(
  props: Readonly<{ severity: NonNullable<ReviewComment["severity"]> }>,
) {
  const t = useT();
  const strong = props.severity === "blocker" || props.severity === "high";
  return (
    <Badge variant="outline" className={strong ? "text-status-needs-you" : undefined}>
      {t(`secondOpinion.severity.${props.severity}` as Key)}
    </Badge>
  );
}
