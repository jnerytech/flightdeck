import type { EffortLevel } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const MIN = 2;
const MAX = 4;

interface Draft {
  model: string;
  effort: string;
}

export interface ArenaVariantInput {
  model?: string;
  effort?: EffortLevel;
}

/** "Iniciar em arena": 2 to 4 variants of the card's request, each with its own model and effort. */
export function ArenaStartForm(props: {
  onStart(variants: ArenaVariantInput[]): void;
  onClose(): void;
}) {
  const t = useT();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    Array.from({ length: MIN }, () => ({ model: "", effort: "" })),
  );
  const edit = (index: number, patch: Partial<Draft>) =>
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const start = () =>
    props.onStart(
      drafts.map((draft) => ({
        ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
        ...(draft.effort ? { effort: draft.effort as EffortLevel } : {}),
      })),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("arenaUi.start")}</DialogTitle>
          <DialogDescription>{t("arenaUi.hint")}</DialogDescription>
        </DialogHeader>
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
                {n === drafts.length && n > MIN && (
                  <Button variant="ghost" size="sm" onClick={() => setDrafts(drafts.slice(0, -1))}>
                    {t("arenaUi.remove", { n })}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          {drafts.length < MAX && (
            <Button
              variant="outline"
              onClick={() => setDrafts([...drafts, { model: "", effort: "" }])}
            >
              {t("arenaUi.add")}
            </Button>
          )}
          <Button variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={start}>{t("arenaUi.begin")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
