import type { Card, WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { useState } from "react";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import type { AppStore } from "../../lib/app-store.ts";
import { incidentText } from "../../lib/incident-text.ts";

/** The workflow the template ships under (`workflowTemplates` in the daemon). */
const WORKFLOW = "post-mortem";

/**
 * Issue #79: "Draft a post-mortem" on a card that failed. The dialog shows the facts the host has
 * of it (the card, its problem, its run, the summary of its session) for the person to read and
 * edit; Start makes a new card and starts it with the post-mortem workflow and that text.
 */
export function PostMortem(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    run: WorkflowRun | null;
    /** The Claude session of the card, when it has one: its summary joins the facts. */
    claudeSessionId: string | null;
    /** The workflows the project can start: trusted and valid; null until the host has answered. */
    workflows: WorkflowInfo[] | null;
    onOpenCard(cardId: string): void;
  }>,
) {
  const t = useT();
  const { store, hostId, card, run } = props;
  const [open, setOpen] = useState(false);
  /** Null while the session's summary is read. */
  const [text, setText] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** The post-mortem card, once made: a start that was refused tries that card again, not a new one. */
  const [made, setMade] = useState<Pick<Card, "id" | "title"> | null>(null);
  if (card.notice === null && run?.status !== "failed") return null;
  const available = props.workflows?.some((w) => w.name === WORKFLOW) ?? false;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setText(null);
    setMade(null);
    const read = props.claudeSessionId
      ? store.sessionRecap(hostId, props.claudeSessionId)
      : Promise.resolve(null);
    void read.then((recap) => setText(incidentText({ card, run, recap })));
  };
  const start = async () => {
    if (text === null || starting) return;
    setStarting(true);
    // `retry: false`: a retry of the banner would repeat one command alone, and leave a card behind.
    const target =
      made ??
      (await store.hostCommand(
        hostId,
        "card.create",
        {
          projectId: card.projectId,
          title: t("postMortem.cardTitle", { title: card.title }),
          description: "",
        },
        { retry: false },
      ));
    if (target) setMade(target);
    const started = target
      ? await store.hostCommand(
          hostId,
          "card.start",
          { cardId: target.id, workflow: WORKFLOW, inputs: { incident: text } },
          { retry: false },
        )
      : null;
    setStarting(false);
    if (!target || !started) return;
    setOpen(false);
    store.success(t("postMortem.started", { title: target.title }), {
      label: t("kanban.openCard"),
      run: () => props.onOpenCard(target.id),
    });
  };

  return (
    // A block of its own, so the button keeps its width in the card's column of sections.
    <div>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            {t("postMortem.open")}
          </Button>
        </DialogTrigger>
        <AppDialogContent>
          <DialogHeader>
            <DialogTitle>{t("postMortem.title")}</DialogTitle>
            <DialogDescription>{t("postMortem.intro")}</DialogDescription>
          </DialogHeader>
          {props.workflows !== null && !available && (
            <InlineNotice tone="warn">{t("postMortem.missing")}</InlineNotice>
          )}
          {made && (
            <InlineNotice tone="warn">
              {t("postMortem.notStarted", { title: made.title })}
            </InlineNotice>
          )}
          {text === null ? (
            <LoadingState label={t("postMortem.loading")} />
          ) : (
            <Textarea
              aria-label={t("postMortem.field")}
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!available || text === null || starting} onClick={() => void start()}>
              {t("postMortem.start")}
            </Button>
          </DialogFooter>
        </AppDialogContent>
      </Dialog>
    </div>
  );
}
