import type { Card, WorkflowInfo } from "@flightdeck/protocol";
import { type ReactNode, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field, NativeSelect } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { PersonaPicker, useSuggestedPersona } from "@/components/personas/persona-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrDescriptionDialog } from "@/components/watch/pr-description-dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

interface Confirming {
  kind: "complete" | "discard";
  warning: string | null;
}

/** What the host lets a card do, from its features. */
export interface CardRunFeatures {
  personas: boolean;
  bg: boolean;
  /** Phase 22: the host watches PRs, so the PR description is offered before the PR opens. */
  watch: boolean;
}

/**
 * How a card runs: the workflow and its inputs, the persona it starts in, and its actions (start,
 * in the background, stop, open the PR, complete, discard). Complete and discard ask first.
 */
export function CardRunForm(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  /** Workflows the card can start with: trusted and valid on the project's base branch. */
  workflows: WorkflowInfo[];
  features: CardRunFeatures;
  /** The arena's Start, placed between Complete and Discard (it knows when it may show). */
  arenaStart: ReactNode;
  /** The card was discarded: the screen goes back. */
  onDiscarded(): void;
}) {
  const t = useT();
  const { store, hostId, card, features } = props;
  const cardId = card.id;
  const [workflow, setWorkflow] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  /** Phase 20: the persona the card starts in, a picker value; `null` until picked (the Developer shows). */
  const [picked, setPersona] = useState<string | null>(null);
  const suggested = useSuggestedPersona(store, hostId, "dev");
  const persona = picked ?? suggested;
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  /** Phase 22: the PR description offered for the person to edit, before the PR opens. */
  const [draft, setDraft] = useState<{ text: string; redacted: number } | null>(null);
  const chosen = props.workflows.find((w) => w.name === workflow);

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

  return (
    <>
      <Panel title={t("cardUi.runTitle")} label={t("cardUi.runTitle")} slot="card-run">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("cardUi.workflow")}>
            {(control) => (
              <NativeSelect
                {...control}
                inline
                value={workflow}
                onChange={(e) => {
                  setWorkflow(e.target.value);
                  setInputs({});
                }}
              >
                <option value="">{t("cardUi.noWorkflow")}</option>
                {props.workflows.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {chosen?.inputs.map((name) => (
            <Field key={name} label={t("cardUi.input", { name })}>
              {(control) => (
                <Input
                  {...control}
                  placeholder={name}
                  className="w-48"
                  value={inputs[name] ?? ""}
                  onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {features.personas && (
            <PersonaPicker
              store={store}
              hostId={hostId}
              label={t("personas.picker.card")}
              value={persona}
              onChange={setPersona}
            />
          )}
          <ActionButton
            onClick={() => {
              const ref = store.personaRef(persona);
              return store.hostCommand(hostId, "card.start", {
                cardId,
                ...(chosen ? { workflow: chosen.name, inputs } : {}),
                ...(ref ? { persona: ref } : {}),
              });
            }}
          >
            {t("cardUi.start")}
          </ActionButton>
          {features.bg && !card.sessionId && (
            <ActionButton
              variant="outline"
              onClick={async () => {
                const started = await store.startBackground(hostId, {
                  cardId,
                  ...(persona.startsWith("host:") ? { persona: persona.slice(5) } : {}),
                });
                if (started) store.router.push({ name: "hub" });
              }}
            >
              {t("bg.start")}
            </ActionButton>
          )}
          <ActionButton
            variant="outline"
            onClick={() => store.hostCommand(hostId, "card.stop", { cardId })}
          >
            {t("cardUi.stop")}
          </ActionButton>
          <ActionButton
            variant="outline"
            disabled={!card.worktreePath || Boolean(card.prUrl)}
            disabledReason={t(card.prUrl ? "cardUi.prAlreadyOpen" : "cardUi.needWorktree")}
            onClick={() => openPr()}
          >
            {t("cardUi.openPr")}
          </ActionButton>
          <Button
            variant="outline"
            onClick={() => setConfirming({ kind: "complete", warning: null })}
          >
            {t("cardUi.complete")}
          </Button>
          {props.arenaStart}
          <Button variant="destructive" onClick={() => void askDiscard()}>
            {t("cardUi.discard")}
          </Button>
        </div>
      </Panel>
      {draft && (
        <PrDescriptionDialog
          text={draft.text}
          redacted={draft.redacted}
          onCancel={() => setDraft(null)}
          onConfirm={async (description) => {
            setDraft(null);
            await store.hostCommand(hostId, "card.pr.create", { cardId, description });
          }}
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
