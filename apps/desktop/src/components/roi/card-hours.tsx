import type { Card } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
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
  const valid = parsed === null || Number.isFinite(parsed);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={t("roiUi.cardHours")}
        inputMode="decimal"
        className="w-28"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ActionButton
        variant="outline"
        onClick={async () => {
          if (!valid) return;
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
  );
}
