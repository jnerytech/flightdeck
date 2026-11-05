import type { PlainInfo } from "@flightdeck/protocol";
import type { KeyboardEvent } from "react";
import { HoldButton } from "@/components/approval/hold-button";
import { Button } from "@/components/ui/button";
import type { T } from "../../i18n/index.ts";

/** A permission request as a yes/no question with its consequence (simple mode, phase 33). */
export function QuestionCard(
  props: Readonly<{
    plain: PlainInfo;
    t: T;
    /** The host is locked to simple: no way to full mode. */
    locked: boolean;
    onAnswer(decision: "allow" | "deny"): void;
    onOpenFull(): void;
    onCopy(text: string): void;
    /** How long the yes of a high-risk question is held; two seconds. */
    holdMs?: number;
  }>,
) {
  const { plain, t } = props;
  const sentence = plain.sentence[t.lang];
  const consequence = plain.consequence[t.lang];

  if (plain.outcome === "needs_full_access") {
    return (
      <fieldset aria-label={t("simple.needsFullTitle")} className="question-card">
        <p className="question-card-title">{t("simple.needsFullTitle")}</p>
        <p className="question-card-note">{t("simple.needsFullText")}</p>
        <div className="question-card-actions">
          {!props.locked && (
            <Button type="button" onClick={props.onOpenFull}>
              {t("simple.openFull")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onCopy(t("simple.adminMessage", { what: sentence }))}
          >
            {t("simple.copyMessage")}
          </Button>
        </div>
      </fieldset>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "a" && !plain.hold) props.onAnswer("allow");
    else if (e.key === "n" || e.key === "Escape") props.onAnswer("deny");
  };
  return (
    <fieldset aria-label={sentence} className="question-card" onKeyDown={onKeyDown}>
      <p className="question-card-title">{sentence}</p>
      <p className="question-card-note">{consequence}</p>
      <div className="question-card-actions">
        {plain.hold ? (
          <HoldButton
            label={t("simple.yes")}
            hint={t("simple.holdHint")}
            holdMs={props.holdMs ?? 2000}
            onHeld={() => props.onAnswer("allow")}
          />
        ) : (
          <Button type="button" onClick={() => props.onAnswer("allow")}>
            {t("simple.yes")}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => props.onAnswer("deny")}>
          {t("simple.no")}
        </Button>
      </div>
    </fieldset>
  );
}
