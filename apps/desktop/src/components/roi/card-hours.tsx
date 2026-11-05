import type { Card } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { Field } from "@/components/layout/form";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { useDraft } from "@/lib/use-draft";

/** Phase 36: the hours this card is worth, an estimate typed by the person; empty clears it. */
export function CardHours(props: { store: AppStore; hostId: string; card: Card }) {
  const { store, hostId, card } = props;
  const t = useT();
  const [text, setText, saved] = useDraft(
    card.estimateHours === null ? "" : String(card.estimateHours),
  );
  const parsed = text.trim() === "" ? null : Number(text);
  // What the host takes: empty (no estimate) or a number of hours from 0 to 1000.
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000);
  const current = card.estimateHours === null ? "" : String(card.estimateHours);
  return (
    <Field label={t("roiUi.cardHours")}>
      {(control) => (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            {...control}
            inputMode="decimal"
            className="w-28"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <ActionButton
            variant="outline"
            disabled={!valid || text === current}
            {...(valid ? {} : { disabledReason: t("roiUi.cardHoursInvalid") })}
            onClick={async () => {
              const sent = text;
              const done = await store.hostCommand(hostId, "card.update", {
                cardId: card.id,
                estimateHours: parsed,
              });
              if (done) saved(sent);
            }}
          >
            {t("roiUi.cardHoursSave")}
          </ActionButton>
        </div>
      )}
    </Field>
  );
}
