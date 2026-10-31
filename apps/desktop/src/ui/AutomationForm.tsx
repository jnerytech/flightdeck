import type {
  Automation,
  AutomationAction,
  AutomationTrigger,
  WorkflowInfo,
} from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import {
  type ActionType,
  actionsFor,
  carriesThirdParty,
  TRIGGER_TYPES,
  type TriggerType,
} from "../lib/automations.ts";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const STEPS = ["trigger", "action", "limit"] as const;

interface Draft {
  trigger: TriggerType;
  expr: string;
  tz: string;
  label: string;
  action: ActionType;
  workflow: string;
  name: string;
  max: string;
  external: boolean;
}

/** The form's starting point: the saved automation, or a weekday morning schedule. */
function draftOf(initial: Automation | null): Draft {
  const { trigger, action } = initial ?? {
    trigger: {
      type: "cron" as const,
      expr: "0 9 * * 1-5",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    action: { type: "start_workflow" as const, workflow: "" },
  };
  return {
    trigger: trigger.type,
    expr: trigger.type === "cron" ? trigger.expr : "0 9 * * 1-5",
    tz: trigger.type === "cron" ? trigger.tz : Intl.DateTimeFormat().resolvedOptions().timeZone,
    label: trigger.type === "issue_label" ? trigger.label : "",
    action: action.type,
    workflow: action.type === "start_workflow" ? action.workflow : "",
    name: initial?.name ?? "",
    max: String(initial?.maxRunsPerDay ?? 10),
    external: initial?.allowExternalAuthors ?? false,
  };
}

function triggerOf(draft: Draft): AutomationTrigger {
  switch (draft.trigger) {
    case "cron":
      return { type: "cron", expr: draft.expr.trim(), tz: draft.tz.trim() };
    case "issue_label":
      return { type: "issue_label", label: draft.label.trim() };
    default:
      return { type: draft.trigger };
  }
}

function actionOf(draft: Draft, workflow: string): AutomationAction {
  return draft.action === "start_workflow"
    ? { type: "start_workflow", workflow }
    : { type: draft.action };
}

/**
 * The guided creation of an automation (and the editing of one): the trigger, the action that
 * fits it, then the limit and whether outside authors count. It is always saved off.
 */
export function AutomationForm(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  workflows: WorkflowInfo[];
  initial: Automation | null;
  onClose(): void;
  onSaved(automation: Automation): void;
}) {
  const { store, initial } = props;
  const { t } = store.i18n;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  const usable = props.workflows.filter((w) => w.errors.length === 0);
  const workflow = usable.some((w) => w.name === draft.workflow)
    ? draft.workflow
    : (usable[0]?.name ?? "");
  const actions = actionsFor(draft.trigger);

  const pickTrigger = (trigger: TriggerType) => {
    const fits = actionsFor(trigger);
    set({ trigger, action: fits.includes(draft.action) ? draft.action : (fits[0] as ActionType) });
  };

  const save = async () => {
    const max = Number.parseInt(draft.max, 10);
    const saved = await store.hostCommand(props.hostId, "automation.save", {
      projectId: props.projectId,
      ...(initial ? { id: initial.id } : {}),
      name: draft.name,
      trigger: triggerOf(draft),
      action: actionOf(draft, workflow),
      ...(Number.isInteger(max) && max >= 1 ? { maxRunsPerDay: max } : {}),
      allowExternalAuthors: carriesThirdParty(draft.trigger) && draft.external,
    });
    if (saved) props.onSaved(saved);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t(initial ? "automationsUi.editTitle" : "automationsUi.new")}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t("automationsUi.form.step", {
            n: step + 1,
            title: t(`automationsUi.form.steps.${STEPS[step]}` as Key),
          })}
        </p>
        {step === 0 && (
          <div className="flex flex-col gap-3">
            <select
              aria-label={t("automationsUi.form.trigger")}
              className={SELECT}
              value={draft.trigger}
              onChange={(e) => pickTrigger(e.target.value as TriggerType)}
            >
              {TRIGGER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`automationsUi.form.triggerTypes.${type}` as Key)}
                </option>
              ))}
            </select>
            {draft.trigger === "cron" && (
              <>
                <Input
                  aria-label={t("automationsUi.form.cron")}
                  placeholder={t("automationsUi.form.cronHint")}
                  value={draft.expr}
                  onChange={(e) => set({ expr: e.target.value })}
                />
                <Input
                  aria-label={t("automationsUi.form.tz")}
                  value={draft.tz}
                  onChange={(e) => set({ tz: e.target.value })}
                />
              </>
            )}
            {draft.trigger === "issue_label" && (
              <Input
                aria-label={t("automationsUi.form.label")}
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
              />
            )}
          </div>
        )}
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <select
              aria-label={t("automationsUi.form.action")}
              className={SELECT}
              value={draft.action}
              onChange={(e) => set({ action: e.target.value as ActionType })}
            >
              {actions.map((type) => (
                <option key={type} value={type}>
                  {t(`automationsUi.form.actionTypes.${type}` as Key)}
                </option>
              ))}
            </select>
            {draft.action === "start_workflow" &&
              (usable.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("automationsUi.form.noWorkflows")}
                </p>
              ) : (
                <select
                  aria-label={t("automationsUi.form.workflow")}
                  className={SELECT}
                  value={workflow}
                  onChange={(e) => set({ workflow: e.target.value })}
                >
                  {usable.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.trusted ? w.name : t("automationsUi.form.untrusted", { name: w.name })}
                    </option>
                  ))}
                </select>
              ))}
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            <Input
              aria-label={t("automationsUi.form.name")}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <Input
              type="number"
              min={1}
              aria-label={t("automationsUi.form.max")}
              value={draft.max}
              onChange={(e) => set({ max: e.target.value })}
            />
            {carriesThirdParty(draft.trigger) && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex flex-col text-sm">
                  {t("automationsUi.form.external")}
                  <span className="text-muted-foreground text-xs">
                    {t("automationsUi.form.externalHint")}
                  </span>
                </span>
                <Switch
                  aria-label={t("automationsUi.form.external")}
                  checked={draft.external}
                  onCheckedChange={(external) => set({ external })}
                />
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              {t(initial?.enabled ? "automationsUi.form.savedOff" : "automationsUi.form.bornOff")}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              {t("automationsUi.form.back")}
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)}>{t("automationsUi.form.next")}</Button>
          ) : (
            <Button onClick={() => void save()}>{t("automationsUi.form.save")}</Button>
          )}
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
