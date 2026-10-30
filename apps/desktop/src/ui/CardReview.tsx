import type { Card, ChangesResult } from "@flightdeck/protocol";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { translateError } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";

type Mode = "merge" | "squash";

/**
 * A card's place against its base (phase 11): how far ahead and behind it is, "Atualizar com a
 * base" and, for a card without a PR, "Merge e arquivar". A refusal (a conflict, a busy card)
 * stays on screen with the host's words, because it lists the files.
 */
export function CardReview(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  changes: ChangesResult;
  refresh(): Promise<void>;
}) {
  const t = useT();
  const { store, hostId, card, changes } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mode, setMode] = useState<Mode>("merge");
  const base = changes.base ?? "";
  const ahead = changes.position?.ahead ?? 0;
  const behind = changes.position?.behind ?? 0;

  const refused = (code: string, message: string) => {
    const { title, detail } = translateError(code, message, t);
    setRefusal(detail ? `${title} ${detail}` : title);
  };

  const update = async () => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "card.updateFromBase", { cardId: card.id });
    if (!result.ok) return refused(result.code, result.message);
    store.success(t("cardReview.updated"));
    await props.refresh();
  };

  const merge = async () => {
    setMerging(false);
    setRefusal(null);
    const result = await store.hostRequest(hostId, "card.mergeLocal", {
      cardId: card.id,
      mode,
      confirm: true,
    });
    if (!result.ok) return refused(result.code, result.message);
    store.success(t("cardReview.merged", { base }));
    await props.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <output aria-label={t("cardReview.positionLabel")} className="text-sm tabular-nums">
          {t("cardReview.position", { ahead, behind, base })}
        </output>
        <Button variant="outline" size="sm" disabled={behind === 0} onClick={() => void update()}>
          {t("cardReview.updateFromBase")}
        </Button>
        {!card.prUrl && (
          <Button
            variant="outline"
            size="sm"
            disabled={ahead === 0}
            onClick={() => setMerging(true)}
          >
            {t("cardReview.merge")}
          </Button>
        )}
      </div>
      {refusal && (
        <div
          role="alert"
          className="rounded-md border border-status-error/40 px-3 py-2 text-sm text-status-error"
        >
          {refusal}
        </div>
      )}
      <AlertDialog open={merging} onOpenChange={(open) => !open && setMerging(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cardReview.merge")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cardReview.mergeMessage", { base })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="font-medium">{t("cardReview.modeLabel")}</legend>
            {(["merge", "squash"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="merge-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {t(value === "merge" ? "cardReview.modeMerge" : "cardReview.modeSquash")}
              </label>
            ))}
          </fieldset>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void merge()}>
              {t("cardReview.merge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
