import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WandBinding } from "@/features/assistant/index.ts";
import { AssistField } from "@/features/assistant/ui.ts";
import { useT } from "@/i18n/context";
import { ActionButton, AppDialogContent } from "@/shared/feedback/index.ts";

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
    /** What the person reads before confirming, below the fields (where the push goes). */
    children?: ReactNode;
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
          binding={{
            ...props.assist,
            kind: "pr.description",
            // The description is written knowing the title the person is about to confirm.
            ...(title.trim() ? { context: { title } } : {}),
          }}
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
        {props.children}
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
