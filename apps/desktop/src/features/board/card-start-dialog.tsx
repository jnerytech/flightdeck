import type { WorkflowInfo } from "@flightdeck/protocol";
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PersonaPicker, useSuggestedPersona } from "@/features/personas/ui.ts";
import { AlertPicker } from "@/features/workflows/ui.ts";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { AppDialogContent } from "@/shared/feedback/index.ts";
import { Field, Inline, NativeSelect, Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { startPersonaOf, startWorkflowOf } from "./domain/card-template.ts";

/**
 * "Iniciar card" from the board's card menu: the workflow and the persona the card starts with
 * (the persona prefilled with the host's suggestion), then Start. Without it the menu started
 * the card with neither, and silently.
 */
export function CardStartDialog(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: {
      id: string;
      projectId: string;
      title: string;
      /** Issue #1201: what a card template chose. */
      startWorkflow?: string | null;
      startPersona?: string | null;
    };
    onClose(): void;
    /** The dialog was opened from a menu item that is gone: the focus goes back to the menu's button (#4272). */
    returnFocus?: (() => void) | undefined;
    /** The card started: the caller tells the person. */
    onStarted(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, card } = props;
  const host = store.getState().hosts.find((h) => h.id === hostId);
  /** Issue #1201: until one is picked, the card's own (a template's) workflow, when the project has it. */
  const [pickedWorkflow, setPickedWorkflow] = useState<string | null>(null);
  /** `null` until `workflow.list` answers; `"failed"` when the host refused it. */
  const [list, setList] = useState<WorkflowInfo[] | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** After a failed list, starting with no workflow is a choice the person makes on purpose. */
  const [withoutWorkflow, setWithoutWorkflow] = useState(false);
  const workflows = Array.isArray(list) ? list : [];
  const ready = list !== null && (list !== "failed" || withoutWorkflow);
  const workflow =
    pickedWorkflow ??
    startWorkflowOf(
      card,
      workflows.map((w) => w.name),
    );
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const suggested = useSuggestedPersona(store, hostId, "dev");
  const hostPersonas = useStoreSlice(store, ["personas"]).personas[hostId];
  const persona =
    picked ??
    startPersonaOf(
      card,
      (hostPersonas ?? []).map((p) => p.id),
    ) ??
    suggested;
  const chosen = workflows.find((w) => w.name === workflow);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-reads the list after "Try again"
  useEffect(() => {
    let current = true;
    void store
      .hostCommand(hostId, "workflow.list", { projectId: card.projectId })
      .then((result) => {
        if (!current) return;
        setList(
          result
            ? (result.workflows ?? []).filter((w) => w.trusted && w.errors.length === 0)
            : "failed",
        );
      });
    return () => {
      current = false;
    };
  }, [store, hostId, card.projectId, attempt]);
  const starting = useRef(false);
  const start = async () => {
    // A second click while the first is on its way would start the card twice.
    if (starting.current || !ready) return;
    starting.current = true;
    const ref = store.personas.ref(persona);
    const started = await store.hostCommand(hostId, "card.start", {
      cardId: card.id,
      ...(chosen ? { workflow: chosen.name, inputs } : {}),
      ...(ref ? { persona: ref } : {}),
    });
    props.onClose();
    if (started) props.onStarted();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent returnFocus={props.returnFocus}>
        <DialogHeader>
          <DialogTitle>{t("board.startCard")}</DialogTitle>
          <DialogDescription>{t("board.startFor", { title: card.title })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={t("cardUi.workflow")}>
            {(control) => (
              <NativeSelect
                {...control}
                value={workflow}
                onChange={(e) => {
                  setPickedWorkflow(e.target.value);
                  setInputs({});
                }}
              >
                <option value="">{t("cardUi.noWorkflow")}</option>
                {workflows.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {chosen?.inputs.map((name) => (
            <Fragment key={name}>
              {/* The alert is several lines (what, where, why): one line would glue them together. */}
              {name === "alert" ? (
                <Textarea
                  aria-label={t("cardUi.input", { name })}
                  placeholder={name}
                  rows={4}
                  value={inputs[name] ?? ""}
                  onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
                />
              ) : (
                <Input
                  aria-label={t("cardUi.input", { name })}
                  placeholder={name}
                  value={inputs[name] ?? ""}
                  onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
                />
              )}
              {name === "alert" && (
                <AlertPicker
                  store={store}
                  hostId={hostId}
                  projectId={card.projectId}
                  onPick={(text) => setInputs({ ...inputs, alert: text })}
                />
              )}
            </Fragment>
          ))}
          {hasFeature(host?.hostInfo?.features, "personas", false) && (
            <PersonaPicker
              store={store}
              hostId={hostId}
              label={t("personas.picker.card")}
              value={persona}
              onChange={setPicked}
            />
          )}
          {list === null && (
            <p className="text-muted-foreground text-sm">{t("board.startLoading")}</p>
          )}
          {list === "failed" && !withoutWorkflow && (
            <div role="alert">
              <Stack gap={2}>
                <p className="text-sm">{t("board.startWorkflowsFailed")}</p>
                <Inline>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setList(null);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    {t("board.startRetry")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setWithoutWorkflow(true)}>
                    {t("board.startWithout")}
                  </Button>
                </Inline>
              </Stack>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ready} onClick={() => void start()}>
            {t("cardUi.start")}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
