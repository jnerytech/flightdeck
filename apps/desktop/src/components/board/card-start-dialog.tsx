import type { WorkflowInfo } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { NativeSelect } from "@/components/layout/form";
import { PersonaPicker, useSuggestedPersona } from "@/components/personas/persona-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";

/**
 * "Iniciar card" from the board's card menu: the workflow and the persona the card starts with
 * (the persona prefilled with the host's suggestion), then Start. Without it the menu started
 * the card with neither, and silently.
 */
export function CardStartDialog(props: {
  store: AppStore;
  hostId: string;
  card: { id: string; projectId: string; title: string };
  onClose(): void;
  /** The card started: the caller tells the person. */
  onStarted(): void;
}) {
  const t = useT();
  const { store, hostId, card } = props;
  const host = store.getState().hosts.find((h) => h.id === hostId);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [workflow, setWorkflow] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const suggested = useSuggestedPersona(store, hostId, "dev");
  const persona = picked ?? suggested;
  const chosen = workflows.find((w) => w.name === workflow);
  useEffect(() => {
    void store
      .hostCommand(hostId, "workflow.list", { projectId: card.projectId })
      .then((result) => {
        setWorkflows((result?.workflows ?? []).filter((w) => w.trusted && w.errors.length === 0));
      });
  }, [store, hostId, card.projectId]);
  const start = async () => {
    const ref = store.personaRef(persona);
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
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("board.startCard")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <NativeSelect
            aria-label={t("cardUi.workflow")}
            value={workflow}
            onChange={(e) => {
              setWorkflow(e.target.value);
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
          {chosen?.inputs.map((name) => (
            <Input
              key={name}
              aria-label={t("cardUi.input", { name })}
              placeholder={name}
              value={inputs[name] ?? ""}
              onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
            />
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void start()}>{t("cardUi.start")}</Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
