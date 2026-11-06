import { useState } from "react";
import { AssistField } from "@/components/assistant/assist-field";
import type { WandBinding } from "@/components/assistant/use-wand";
import { ActionButton } from "@/components/feedback/action-button";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";

/**
 * Phase 22: the PR description made from the card's sessions, for the person to read and edit.
 * Nothing is opened until the confirmation; a line that looked like a secret was already taken out.
 */
export function PrDescriptionDialog(
  props: Readonly<{
    text: string;
    /** The PR's title to start from: the card's (issue #162). */
    title: string;
    redacted: number;
    /** The wands of the title and the description, on the card's repo. */
    assist: Omit<WandBinding, "kind">;
    onConfirm(text: string, title: string): unknown;
    onCancel(): void;
  }>,
) {
  const t = useT();
  const [text, setText] = useState(props.text);
  const [title, setTitle] = useState(props.title);
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
        <AssistField
          binding={{ ...props.assist, kind: "pr.title" }}
          value={title}
          onChange={setTitle}
          t={t}
        >
          {(assist) => (
            <Input
              {...assist}
              aria-label={t("watchUi.prTitle")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </AssistField>
        <AssistField
          binding={{ ...props.assist, kind: "pr.description" }}
          value={text}
          onChange={setText}
          t={t}
        >
          {(assist) => (
            <Textarea
              {...assist}
              aria-label={t("watchUi.descriptionTitle")}
              className="min-h-48"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </AssistField>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onCancel}>
            {t("common.cancel")}
          </Button>
          <ActionButton onClick={() => props.onConfirm(text, title.trim() || props.title)}>
            {t("watchUi.confirm")}
          </ActionButton>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
