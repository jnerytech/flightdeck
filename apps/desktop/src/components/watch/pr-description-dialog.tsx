import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";

/**
 * Phase 22: the PR description made from the card's sessions, for the person to read and edit.
 * Nothing is opened until the confirmation; a line that looked like a secret was already taken out.
 */
export function PrDescriptionDialog(props: {
  text: string;
  redacted: number;
  onConfirm(text: string): unknown;
  onCancel(): void;
}) {
  const t = useT();
  const [text, setText] = useState(props.text);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("watchUi.descriptionTitle")}</DialogTitle>
        </DialogHeader>
        {props.redacted > 0 && (
          <p className="text-status-needs-you text-sm">
            {t(props.redacted === 1 ? "watchUi.redactedOne" : "watchUi.redactedMany", {
              n: props.redacted,
            })}
          </p>
        )}
        <Textarea
          aria-label={t("watchUi.descriptionTitle")}
          className="min-h-48"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onCancel}>
            {t("common.cancel")}
          </Button>
          <ActionButton onClick={() => props.onConfirm(text)}>{t("watchUi.confirm")}</ActionButton>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
