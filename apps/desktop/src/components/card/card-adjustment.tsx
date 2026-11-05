import type { Card } from "@flightdeck/protocol";
import { useState } from "react";
import { Field } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

/** A message to the card's running session: an adjustment, sent with its button. */
export function CardAdjustment(props: { store: AppStore; hostId: string; cardId: string }) {
  const t = useT();
  const [adjustment, setAdjustment] = useState("");
  const send = () => {
    if (!adjustment.trim()) return;
    void props.store.hostCommand(props.hostId, "card.message", {
      cardId: props.cardId,
      text: adjustment.trim(),
    });
    setAdjustment("");
  };
  return (
    <Field label={t("cardUi.adjustment")}>
      {(control) => (
        <div className="field-with-action">
          <Textarea
            {...control}
            placeholder={t("cardUi.adjustmentPlaceholder")}
            value={adjustment}
            className="min-h-16 flex-1"
            onChange={(e) => setAdjustment(e.target.value)}
          />
          <Button variant="outline" onClick={send}>
            {t("cardUi.askAdjustment")}
          </Button>
        </div>
      )}
    </Field>
  );
}

/** Where a run stands: ended, running or still queued. */
function runState(
  run: Card["runs"][number],
): "cardUi.runEnded" | "cardUi.runActive" | "cardUi.runQueued" {
  if (run.endedAt) return "cardUi.runEnded";
  return run.startedAt ? "cardUi.runActive" : "cardUi.runQueued";
}

/** Every run of the card, oldest first: its number, when it was queued and where it stands. */
export function CardRuns(props: { runs: Card["runs"]; formatDateTime(iso: string): string }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-sm">{t("cardUi.runs")}</h3>
      <ul
        aria-label={t("cardUi.runs")}
        className="flex flex-col gap-1 text-muted-foreground text-xs"
      >
        {props.runs.map((run, i) => (
          <li key={run.queuedAt} className="tabular-nums">
            {[`#${i + 1}`, props.formatDateTime(run.queuedAt), t(runState(run))].join(" · ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
