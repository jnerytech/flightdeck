import type { Card } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CardStartDialog } from "@/components/board/card-start-dialog";
import { ActionButton } from "@/components/feedback/action-button";
import { FieldRow } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { useSuggestedPersona } from "@/components/personas/persona-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PrDescriptionDialog } from "@/components/watch/pr-description-dialog";
import { projectContracts, useStartAsk } from "@/hooks/use-start-ask";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { nextStep } from "../../lib/card-next-step.ts";
import { cardStartBlock } from "../../lib/card-start-block.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { CardFinishDialog } from "./card-finish.tsx";

interface Confirming {
  kind: "complete" | "discard";
  warning: string | null;
}

/** What the host lets a card do, from its features. */
export interface CardRunFeatures {
  bg: boolean;
  /** Phase 22: the host watches PRs, so the PR description is offered before the PR opens. */
  watch: boolean;
}

/**
 * How a card runs: the one button for its next step (Start, Stop, Review changes, Open PR) and,
 * under a menu, the rest (start with a workflow or persona, in the background, finish, discard).
 * Complete and discard ask first (#1197).
 */
export function CardRunForm(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    features: CardRunFeatures;
    /** The tab of the card page that shows: Review changes leads while it is the conversation (#1197). */
    tab: "conversation" | "diff";
    /** The card's PR is open and can be merged from here (#1197): Merge PR leads. */
    canMerge: boolean;
    /** Merge PR was chosen: the page asks to confirm. */
    onMerge(): void;
    /** The arena's Start, placed between Complete and Discard (it knows when it may show). */
    arenaStart: ReactNode;
    /** The card was discarded: the screen goes back. */
    onDiscarded(): void;
    /** Finish… chose to merge: the screen shows the card's diff, where the merge is. */
    onShowDiff(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, card, features } = props;
  const cardId = card.id;
  /** Phase 20: the persona a plain Start uses: the one the host suggests for a dev card. */
  const suggested = useSuggestedPersona(store, hostId, "dev");
  /** "Start with a workflow or persona…": the board's start dialog, over the card. */
  const [startingWith, setStartingWith] = useState(false);
  /** The project's contracts decide whether a card with no criteria is asked about (issue #78). */
  const contracts = projectContracts(store, hostId, card.projectId);
  const startAsk = useStartAsk();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [finishing, setFinishing] = useState(false);
  /** Phase 22: the PR description offered for the person to edit, before the PR opens. */
  const [draft, setDraft] = useState<{ text: string; redacted: number } | null>(null);

  const askDiscard = async () => {
    const current = card.worktreePath
      ? await store.hostCommand(hostId, "card.diff", { cardId })
      : null;
    const files = current?.files ?? [];
    const unsent = files.some((f) => f.uncommitted) || (files.length > 0 && !card.prUrl);
    setConfirming({ kind: "discard", warning: unsent ? t("cardUi.unsent") : null });
  };

  const confirm = async () => {
    const kind = confirming?.kind;
    setConfirming(null);
    if (kind === "complete") {
      await store.hostCommand(hostId, "card.complete", { cardId, confirm: true });
    } else {
      const discarded = await store.hostCommand(hostId, "card.discard", { cardId, confirm: true });
      if (discarded) props.onDiscarded();
    }
  };

  /** Opens the PR: where the host watches PRs, the description is offered first and nothing opens until it is confirmed. */
  const openPr = async () => {
    if (!features.watch) return store.hostCommand(hostId, "card.pr.create", { cardId });
    const offered = await store.describePr(hostId, cardId);
    if (offered) setDraft(offered);
    return undefined;
  };

  const step = nextStep(card, { tab: props.tab, canMerge: props.canMerge });
  const running = cardStartBlock(card) !== null;
  /** A session that is still there (even idle) or a card that waits: Stop has something to stop. */
  const alive =
    card.queued ||
    (card.sessionId !== null && !["ended", "error"].includes(card.sessionStatus ?? ""));
  const startPlain = () => {
    const ref = store.personaRef(suggested);
    // A card from a template (#1201) starts through the dialog, so its workflow and persona show.
    if (card.startWorkflow || card.startPersona) {
      startAsk.ask(card, contracts, () => setStartingWith(true));
      return;
    }
    startAsk.ask(card, contracts, () => {
      void store.hostCommand(hostId, "card.start", { cardId, ...(ref ? { persona: ref } : {}) });
    });
  };
  const stop = () => store.hostCommand(hostId, "card.stop", { cardId });
  const lead = {
    start: { label: t("cardUi.start"), variant: "default" as const, run: startPlain },
    stop: { label: t("cardUi.stop"), variant: "outline" as const, run: stop },
    review: {
      label: t("cardUi.reviewChanges"),
      variant: "default" as const,
      run: () => props.onShowDiff(),
    },
    "open-pr": {
      label: t("cardUi.openPr"),
      variant: "default" as const,
      run: () => openPr(),
    },
    "merge-pr": {
      label: t("cardMergePr.action"),
      variant: "default" as const,
      run: () => props.onMerge(),
    },
    none: null,
  }[step ?? "none"];
  const canOpenPr = Boolean(card.worktreePath) && !card.prUrl;

  return (
    <>
      <Panel title={t("cardUi.runTitle")} label={t("cardUi.runTitle")} slot="card-run">
        <FieldRow align="end">
          {lead && (
            // One element whatever the step is, so the focus stays on it when its name changes.
            <ActionButton variant={lead.variant} onClick={lead.run}>
              {lead.label}
            </ActionButton>
          )}
          {props.arenaStart}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("board.cardActions", { title: card.title })}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {step !== "start" && !running && (
                <DropdownMenuItem onSelect={startPlain}>{t("cardUi.start")}</DropdownMenuItem>
              )}
              {!running && (
                <DropdownMenuItem
                  onSelect={() => startAsk.ask(card, contracts, () => setStartingWith(true))}
                >
                  {t("cardUi.startWith")}
                </DropdownMenuItem>
              )}
              {features.bg && !card.sessionId && (
                <DropdownMenuItem
                  onSelect={() =>
                    startAsk.ask(card, contracts, () => {
                      const ref = suggested.startsWith("host:") ? suggested.slice(5) : null;
                      void store
                        .startBackground(hostId, { cardId, ...(ref ? { persona: ref } : {}) })
                        .then((started) => {
                          if (started) store.router.push({ name: "hub" });
                        });
                    })
                  }
                >
                  {t("bg.start")}
                </DropdownMenuItem>
              )}
              {step !== "stop" && alive && (
                <DropdownMenuItem onSelect={() => void stop()}>{t("cardUi.stop")}</DropdownMenuItem>
              )}
              {step !== "merge-pr" && props.canMerge && (
                <DropdownMenuItem onSelect={() => props.onMerge()}>
                  {t("cardMergePr.action")}
                </DropdownMenuItem>
              )}
              {step !== "open-pr" && canOpenPr && (
                <DropdownMenuItem onSelect={() => void openPr()}>
                  {t("cardUi.openPr")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setFinishing(true)}>
                {t("cardUi.finish")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void askDiscard()}>
                {t("cardUi.discard")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>
      </Panel>
      {startingWith && (
        <CardStartDialog
          store={store}
          hostId={hostId}
          card={card}
          onClose={() => setStartingWith(false)}
          onStarted={() => {}}
        />
      )}
      {startAsk.dialog}
      {draft && (
        <PrDescriptionDialog
          text={draft.text}
          title={card.title}
          redacted={draft.redacted}
          assist={{
            controller: store.assistant,
            fieldHostId: hostId,
            source: { kind: "card", cardId },
            openSettings: store.openAssistantSettings,
          }}
          onCancel={() => setDraft(null)}
          onConfirm={async (description, title) => {
            setDraft(null);
            await store.hostCommand(hostId, "card.pr.create", { cardId, description, title });
          }}
        />
      )}
      {finishing && (
        <CardFinishDialog
          store={store}
          hostId={hostId}
          card={card}
          onClose={() => setFinishing(false)}
          onComplete={() => setConfirming({ kind: "complete", warning: null })}
          onMerge={props.onShowDiff}
        />
      )}
      {confirming && (
        <ConfirmDialog
          message={
            confirming.kind === "complete"
              ? t("cardUi.completeMessage")
              : t("cardUi.discardMessage")
          }
          warning={confirming.warning}
          confirmLabel={
            confirming.kind === "complete"
              ? t("cardUi.completeConfirm")
              : t("cardUi.discardConfirm")
          }
          destructive={confirming.kind === "discard"}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
