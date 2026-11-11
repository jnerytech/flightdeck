import type { BoardColumn, Card } from "@flightdeck/protocol";
import { useRef, useState } from "react";
import { AssistField } from "@/components/assistant/assist-field";
import { ActionButton } from "@/components/feedback/action-button";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { applyTemplate, CardTemplateField } from "./card-template-field.tsx";

/**
 * The New card dialog of a project's board: a title and a description (each with the assistant's
 * suggestion), optionally filled from a card template. The column whose + was pressed is part of the
 * command, so the card is made in that column in one step. It owns what was typed and forgets it when
 * it closes.
 */
export function NewCardDialog(
  props: Readonly<{
    t: T;
    store: AppStore;
    hostId: string;
    projectId: string;
    open: boolean;
    /** The column whose + was pressed. */
    column: BoardColumn;
    /** The host announces card templates. */
    cardTemplates: boolean;
    /** The dialog closed, by Cancel, Esc or a made card: the board forgets the column. */
    onClose(): void;
    onOpenCard(cardId: string): void;
    /** A card was made: the board puts the focus on it once it shows (#1546). */
    onMade(card: Card): void;
    /** Opens Settings, section Assistant (the wand found no provider). */
    onOpenSettings(): void;
  }>,
) {
  const { t, store, hostId, projectId } = props;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /** Issue #1201: the card template picked, and the text it put in the description. */
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  /** A card was made: the focus goes to it, not back to the + that opened the dialog. */
  const made = useRef(false);

  /** Closes the dialog and forgets what was typed. */
  const close = () => {
    made.current = false;
    props.onClose();
    setTitle("");
    setDescription("");
    setTemplateId(null);
    setFilled(null);
  };

  const create = async () => {
    // The column whose + was pressed is part of the command: one step, nothing to move afterwards.
    const card = await store.hostCommand(
      hostId,
      "card.create",
      {
        projectId,
        title: title.trim(),
        description,
        ...(templateId === null ? {} : { templateId }),
        ...(props.column === "backlog" ? {} : { column: props.column }),
      },
      // A refusal keeps the dialog open with what was typed; the toast takes the focus only if it was lost.
      { focusRefusal: true },
    );
    // Issue #229: only a card that exists closes the dialog; a refused one keeps what was typed
    // (the banner says why). A made card says so, with a way to open it (issue #188).
    if (!card) return card;
    close();
    made.current = true;
    props.onMade(card);
    store.success(t("kanban.created", { title: card.title }), {
      label: t("kanban.openCard"),
      run: () => props.onOpenCard(card.id),
    });
    return card;
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && close()}>
      <AppDialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!made.current) return;
          made.current = false;
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("kanban.newCard")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <CardTemplateField
            store={store}
            hostId={hostId}
            projectId={projectId}
            enabled={props.cardTemplates}
            value={templateId}
            onPick={(picked) => {
              setTemplateId(picked?.id ?? null);
              const next = applyTemplate({ description, filled }, picked);
              setDescription(next.description);
              setFilled(next.filled);
            }}
          />
          <AssistField
            binding={{
              controller: store.assistant,
              kind: "card.title",
              fieldHostId: hostId,
              ...(description.trim() ? { context: { description } } : {}),
              openSettings: props.onOpenSettings,
            }}
            value={title}
            onChange={setTitle}
            t={t}
          >
            {(control) => (
              <Input
                aria-label={t("kanban.titleLabel")}
                placeholder={t("kanban.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                {...control}
              />
            )}
          </AssistField>
          <AssistField
            binding={{
              controller: store.assistant,
              kind: "card.description",
              fieldHostId: hostId,
              ...(title.trim() ? { context: { title } } : {}),
              openSettings: props.onOpenSettings,
            }}
            value={description}
            onChange={setDescription}
            t={t}
          >
            {(control) => (
              <Textarea
                aria-label={t("kanban.descriptionLabel")}
                placeholder={t("kanban.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                {...control}
              />
            )}
          </AssistField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <ActionButton
              type="submit"
              disabled={!title.trim()}
              disabledReason={t("kanban.needTitle")}
            >
              {t("kanban.create")}
            </ActionButton>
          </DialogFooter>
        </form>
      </AppDialogContent>
    </Dialog>
  );
}
