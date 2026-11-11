import type { Card } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CardStartDialog } from "@/components/board/card-start-dialog";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { FieldRow } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PrDescriptionDialog } from "@/components/watch/pr-description-dialog";
import { useSuggestedPersona } from "@/features/personas/index.ts";
import { projectContracts, useStartAsk } from "@/hooks/use-start-ask";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import { findingsNote } from "@/lib/second-opinion";
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
  /** #1446: the host offers the second-opinion review, so the PR description says what is open. */
  secondOpinion?: boolean;
  /** #1568: the host reads a project's PR provider from its remote (`project.detectProvider`). */
  prDetect?: boolean;
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
    /** The card's run waits at a gate: the gate's own buttons lead, not the run panel's (#1269). */
    gateWaiting: boolean;
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
  const [draft, setDraft] = useState<{
    text: string;
    redacted: number;
    /** #1446: the reviewer findings still open, when a blocker or a high one is. */
    note: string | null;
  } | null>(null);

  /** Why the host refused the PR, shown in the description dialog (#1543). */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Counts the PR dialogs opened or cancelled: a late answer for an earlier one is ignored. */
  const prDialog = useRef(0);

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

  /** The reviewer findings still open on this card, as a line for the Open PR confirm. */
  const openFindingsNote = async (): Promise<string | null> => {
    if (!features.secondOpinion) return null;
    const listed = await store.hostCommand(hostId, "review.list", { target: `card:${cardId}` });
    return listed ? findingsNote(t, listed.comments) : null;
  };

  /** Opens the PR: where the host watches PRs, the description is offered first and nothing opens until it is confirmed. */
  const openPr = async () => {
    if (!features.watch) return store.hostCommand(hostId, "card.pr.create", { cardId });
    const offered = await store.prWatch.describe(hostId, cardId);
    prDialog.current += 1;
    setRefusal(null);
    if (offered) setDraft({ ...offered, note: await openFindingsNote() });
    return undefined;
  };

  const canOpenPr = Boolean(card.worktreePath) && !card.prUrl;
  // A project with no PR provider (no remote) cannot open one: say so, instead of asking for the text first (#1543).
  const provider = store.getState().projects[hostId]?.find((one) => one.id === card.projectId);
  const noRemote = canOpenPr && provider?.prProvider === "none";
  /** #1568: what the host found when it looked at the remote, for the note. */
  const [looked, setLooked] = useState<{ outcome: string; host: string | null } | null>(null);
  /** The note: why there is no Open PR, as far as the host could tell. */
  const noteText = () => {
    if (looked?.outcome === "unsupported")
      return looked.host
        ? t("cardUi.noRemoteOther", { host: looked.host })
        : t("cardUi.noRemoteElsewhere");
    if (looked?.outcome === "unreadable") return t("cardUi.remoteUnreadable");
    return t("cardUi.noRemote");
  };
  const lookAtRemote = async (pressed = false) => {
    const found = await store.detectPrProvider(hostId, card.projectId, pressed);
    if (found) setLooked({ outcome: found.outcome, host: found.host });
    return found;
  };
  /** The lead button, and whether the focus is owed to it: the press that found the provider removed the button it was on. */
  const leadRef = useRef<HTMLButtonElement>(null);
  const focusLead = useRef(false);
  useEffect(() => {
    if (noRemote || !focusLead.current) return;
    focusLead.current = false;
    leadRef.current?.focus();
  }, [noRemote]);
  // A project with no provider: the host reads it from the remote when the card shows, in case one was added since.
  const lookOnShow = noRemote && features.prDetect === true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once for each card and project that shows it
  useEffect(() => {
    // What was found for another card's project is not this one's.
    setLooked(null);
    if (lookOnShow) void lookAtRemote();
  }, [lookOnShow, card.projectId]);
  const step = nextStep(card, {
    tab: props.tab,
    canMerge: props.canMerge,
    gate: props.gateWaiting,
    noPr: noRemote,
  });
  const running = cardStartBlock(card) !== null;
  /** A card starts when nothing runs for it and no run waits at a gate: the host refuses a start over a waiting run. */
  const startable = !running && step !== "gate";
  /** A session that is still there (even idle) or a card that waits: Stop has something to stop. */
  const alive =
    card.queued ||
    (card.sessionId !== null && !["ended", "error"].includes(card.sessionStatus ?? ""));
  const startPlain = () => {
    const ref = store.personas.ref(suggested);
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
    gate: null,
    none: null,
  }[step ?? "none"];

  return (
    <>
      <Panel title={t("cardUi.runTitle")} label={t("cardUi.runTitle")} slot="card-run">
        <FieldRow align="end">
          {lead && (
            // One element whatever the step is, so the focus stays on it when its name changes.
            <ActionButton ref={leadRef} variant={lead.variant} onClick={lead.run}>
              {lead.label}
            </ActionButton>
          )}
          {props.arenaStart}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" aria-label={t("board.cardActions", { title: card.title })}>
                <MoreHorizontal aria-hidden="true" />
                {t("cardUi.menu")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {step !== "start" && startable && (
                <DropdownMenuItem onSelect={startPlain}>{t("cardUi.start")}</DropdownMenuItem>
              )}
              {startable && (
                <DropdownMenuItem
                  onSelect={() => startAsk.ask(card, contracts, () => setStartingWith(true))}
                >
                  {t("cardUi.startWith")}
                </DropdownMenuItem>
              )}
              {startable && features.bg && !card.sessionId && (
                <DropdownMenuItem
                  onSelect={() =>
                    startAsk.ask(card, contracts, () => {
                      const ref = suggested.startsWith("host:") ? suggested.slice(5) : null;
                      void store.background
                        .start(hostId, { cardId, ...(ref ? { persona: ref } : {}) })
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
              {step !== "open-pr" && canOpenPr && !noRemote && (
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
        {noRemote && (
          <Stack gap={1}>
            <p className="text-sm">{noteText()}</p>
            {features.prDetect && (
              <div>
                <ActionButton
                  variant="outline"
                  onClick={async () => {
                    // The note and this button go as soon as the provider is saved, before the answer returns here.
                    focusLead.current = true;
                    const found = await lookAtRemote(true);
                    if (found?.outcome !== "set") focusLead.current = false;
                  }}
                >
                  {t("cardUi.checkRemote")}
                </ActionButton>
              </div>
            )}
            {card.branch && (
              <p className="text-muted-foreground text-sm">
                {t("cardUi.noRemoteBranch", { branch: card.branch })}
              </p>
            )}
          </Stack>
        )}
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
          onCancel={() => {
            prDialog.current += 1;
            setRefusal(null);
            setDraft(null);
          }}
          onConfirm={async (description, title) => {
            // The dialog closes once the host took it. A refusal is read here, where the person is
            // (a toast sits behind the modal), and the text stays for another try (#1543).
            const mine = prDialog.current;
            const result = await store.hostRequest(hostId, "card.pr.create", {
              cardId,
              description,
              title,
            });
            // Cancelled meanwhile: the dialog it was for is gone, and so is its answer.
            if (prDialog.current !== mine) return;
            if (result.ok) {
              setRefusal(null);
              setDraft(null);
            } else setRefusal(refusalText(result.code, result.message, t, result));
          }}
        >
          {refusal && <InlineNotice tone="error">{refusal}</InlineNotice>}
          {draft.note && <p className="text-status-needs-you text-sm">{draft.note}</p>}
        </PrDescriptionDialog>
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
