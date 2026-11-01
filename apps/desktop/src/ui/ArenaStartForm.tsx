import type { EffortLevel } from "@flightdeck/protocol";
import { type ReactNode, useState } from "react";
import { Form, FormActions } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const MIN = 2;
const MAX = 4;

interface Draft {
  model: string;
  effort: string;
  persona: string;
}

export interface ArenaVariantInput {
  model?: string;
  effort?: EffortLevel;
  /** Phase 20: a value of the persona picker (a host: or app: prefix and the id). */
  persona?: string;
}

/** "Iniciar em arena": 2 to 4 variants of the card's request, each with its own model and effort. */
export function ArenaStartForm(props: {
  onStart(variants: ArenaVariantInput[]): void;
  onClose(): void;
  /** Phase 20: the persona picker of variant `n`, when the host keeps personas. */
  persona?(n: number, value: string, onChange: (value: string) => void): ReactNode;
}) {
  const t = useT();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    Array.from({ length: MIN }, () => ({ model: "", effort: "", persona: "" })),
  );
  const edit = (index: number, patch: Partial<Draft>) =>
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const start = () =>
    props.onStart(
      drafts.map((draft) => ({
        ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
        ...(draft.effort ? { effort: draft.effort as EffortLevel } : {}),
        ...(draft.persona ? { persona: draft.persona } : {}),
      })),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{t("arenaUi.start")}</DialogTitle>
          <DialogDescription>{t("arenaUi.hint")}</DialogDescription>
        </DialogHeader>
        <Form variant="dialog" onSubmit={start}>
          <div className="flex flex-col gap-2">
            {drafts.map((draft, i) => {
              const n = i + 1;
              return (
                // The rows have no identity beyond their position: the last one is what goes.
                // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={t("arenaUi.model", { n })}
                    placeholder={t("arenaUi.modelPlaceholder")}
                    value={draft.model}
                    onChange={(e) => edit(i, { model: e.target.value })}
                  />
                  <select
                    aria-label={t("arenaUi.effort", { n })}
                    className={SELECT}
                    value={draft.effort}
                    onChange={(e) => edit(i, { effort: e.target.value })}
                  >
                    <option value="">{t("arenaUi.effortDefault")}</option>
                    {EFFORTS.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                  {props.persona?.(n, draft.persona, (persona) => edit(i, { persona }))}
                  {n === drafts.length && n > MIN && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDrafts(drafts.slice(0, -1))}
                    >
                      {t("arenaUi.remove", { n })}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <FormActions
            submit={t("arenaUi.begin")}
            cancel={t("common.cancel")}
            onCancel={props.onClose}
            extra={
              drafts.length < MAX && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDrafts([...drafts, { model: "", effort: "", persona: "" }])}
                >
                  {t("arenaUi.add")}
                </Button>
              )
            }
          />
        </Form>
      </AppDialogContent>
    </Dialog>
  );
}
