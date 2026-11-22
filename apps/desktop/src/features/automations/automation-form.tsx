import type { Automation, WorkflowInfo } from "@flightdeck/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, Form, FormActions, NativeSelect } from "@/shared/layout/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { AppDialogContent, InlineNotice } from "../../shared/feedback/index.ts";
import {
  actionOf,
  type Draft,
  draftOf,
  draftProblems,
  refusedField,
  STEPS,
  timeZones,
  triggerOf,
} from "./domain/automation-draft.ts";
import {
  type ActionType,
  actionsFor,
  carriesThirdParty,
  TRIGGER_TYPES,
  type TriggerType,
} from "./domain/automations.ts";

/**
 * The guided creation of an automation (and the editing of one): the trigger, the action that
 * fits it, then the limit and whether outside authors count. It is always saved off.
 */
export function AutomationForm(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    workflows: WorkflowInfo[];
    initial: Automation | null;
    onClose(): void;
    onSaved(automation: Automation): void;
  }>,
) {
  const { store, initial } = props;
  const { t } = store.i18n;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(initial, Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  // What the daemon refused: a message on the cron or time zone field (the step goes back to it), or one for the dialog.
  const [fieldError, setFieldError] = useState<{ field: "expr" | "tz"; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<"expr" | "tz" | null>(null);
  const exprRef = useRef<HTMLInputElement>(null);
  const tzRef = useRef<HTMLInputElement>(null);
  const zonesId = useId();
  const zones = useRef(timeZones()).current;
  useEffect(() => {
    if (focusField && step === 0) {
      (focusField === "expr" ? exprRef : tzRef).current?.focus();
      setFocusField(null);
    }
  }, [focusField, step]);
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setNotice(null);
    if (fieldError && fieldError.field in patch) setFieldError(null);
  };
  // The name and limit messages show after the first Save press, then follow what is typed.
  const [tried, setTried] = useState(false);
  const usable = props.workflows.filter((w) => w.errors.length === 0);
  const problems = draftProblems(draft, usable.length > 0);
  // A step that cannot work stays shut: Next says why, instead of the daemon refusing at the end.
  const blocked = (step === 0 && problems.label) || (step === 1 && problems.workflow);
  const blockedReason =
    step === 0 ? t("automationsUi.form.labelMissing") : t("automationsUi.form.workflowMissing");
  const workflow = usable.some((w) => w.name === draft.workflow)
    ? draft.workflow
    : (usable[0]?.name ?? "");
  const actions = actionsFor(draft.trigger);

  const pickTrigger = (trigger: TriggerType) => {
    const fits = actionsFor(trigger);
    set({ trigger, action: fits.includes(draft.action) ? draft.action : (fits[0] as ActionType) });
  };

  const save = async () => {
    if (problems.name || problems.max) {
      setTried(true);
      return;
    }
    setNotice(null);
    const result = await store.hostRequest(props.hostId, "automation.save", {
      projectId: props.projectId,
      ...(initial ? { id: initial.id } : {}),
      name: draft.name,
      trigger: triggerOf(draft),
      action: actionOf(draft, workflow),
      maxRunsPerDay: Number(draft.max.trim()),
      allowExternalAuthors: carriesThirdParty(draft.trigger) && draft.external,
    });
    if (result.ok) {
      props.onSaved(result.data);
      return;
    }
    const text = refusalText(result.code, result.message, t, result);
    const field = refusedField(result.reason);
    if (field) {
      setFieldError({ field, text });
      setFocusField(field);
      setStep(0);
    } else {
      setNotice(text);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t(initial ? "automationsUi.editTitle" : "automationsUi.new")}</DialogTitle>
        </DialogHeader>
        <Form
          variant="dialog"
          onSubmit={() => {
            if (blocked) return;
            if (step < 2) setStep(step + 1);
            else void save();
          }}
        >
          <p className="text-muted-foreground text-sm">
            {t("automationsUi.form.step", {
              n: step + 1,
              title: t(`automationsUi.form.steps.${STEPS[step]}` as Key),
            })}
          </p>
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <Field label={t("automationsUi.form.trigger")}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={draft.trigger}
                    onChange={(e) => pickTrigger(e.target.value as TriggerType)}
                  >
                    {TRIGGER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`automationsUi.form.triggerTypes.${type}` as Key)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {draft.trigger === "cron" && (
                <>
                  <Field
                    label={t("automationsUi.form.cron")}
                    help={t("automationsUi.form.cronHint")}
                    error={fieldError?.field === "expr" ? fieldError.text : undefined}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        ref={exprRef}
                        value={draft.expr}
                        onChange={(e) => set({ expr: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={t("automationsUi.form.tz")}
                    error={fieldError?.field === "tz" ? fieldError.text : undefined}
                  >
                    {(control) => (
                      <>
                        <Input
                          {...control}
                          ref={tzRef}
                          list={zonesId}
                          value={draft.tz}
                          onChange={(e) => set({ tz: e.target.value })}
                        />
                        <datalist id={zonesId}>
                          {zones.map((zone) => (
                            <option key={zone} value={zone} />
                          ))}
                        </datalist>
                      </>
                    )}
                  </Field>
                </>
              )}
              {draft.trigger === "issue_label" && (
                <Field label={t("automationsUi.form.label")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.label}
                      onChange={(e) => set({ label: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          )}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <Field label={t("automationsUi.form.action")}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={draft.action}
                    onChange={(e) => set({ action: e.target.value as ActionType })}
                  >
                    {actions.map((type) => (
                      <option key={type} value={type}>
                        {t(`automationsUi.form.actionTypes.${type}` as Key)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {draft.action === "start_workflow" &&
                (usable.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("automationsUi.form.noWorkflows")}
                  </p>
                ) : (
                  <Field label={t("automationsUi.form.workflow")}>
                    {(control) => (
                      <NativeSelect
                        {...control}
                        value={workflow}
                        onChange={(e) => set({ workflow: e.target.value })}
                      >
                        {usable.map((w) => (
                          <option key={w.name} value={w.name}>
                            {w.trusted
                              ? w.name
                              : t("automationsUi.form.untrusted", { name: w.name })}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                ))}
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              <Field
                label={t("automationsUi.form.name")}
                error={tried && problems.name ? t("automationsUi.form.nameMissing") : undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label={t("automationsUi.form.max")}
                error={tried && problems.max ? t("automationsUi.form.maxBad") : undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    // No `min` and any step: the browser would stop the submit with its own bubble, and the field's message in both languages would never show.
                    step="any"
                    value={draft.max}
                    onChange={(e) => set({ max: e.target.value })}
                  />
                )}
              </Field>
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
          {notice !== null && <InlineNotice tone="error">{notice}</InlineNotice>}
          <FormActions
            submit={t(step < 2 ? "automationsUi.form.next" : "automationsUi.form.save")}
            disabled={blocked}
            disabledReason={blockedReason}
            cancel={t("common.cancel")}
            onCancel={props.onClose}
            extra={
              step > 0 && (
                <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                  {t("automationsUi.form.back")}
                </Button>
              )
            }
          />
        </Form>
      </AppDialogContent>
    </Dialog>
  );
}
