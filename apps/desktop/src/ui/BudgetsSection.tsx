import type { Budget, BudgetInput } from "@flightdeck/protocol";
import { useState } from "react";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { ListRow } from "@/components/layout/list-row";
import { Panel } from "@/components/layout/panel";
import { Grid, Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { budgetLabel, budgetLine } from "../lib/budgets.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

interface Draft {
  id?: string;
  scope: Budget["scope"];
  projectKey: string;
  period: Budget["period"];
  limitUsd: string;
  action: Budget["action"];
}

const EMPTY: Draft = {
  scope: "host",
  projectKey: "",
  period: "day",
  limitUsd: "",
  action: "notify",
};

/** A host's budgets with what each one spent in its period, and a form to create or edit one. */
export function BudgetsSection(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  budgets: Budget[];
}) {
  const t = useT();
  const { store, hostId } = props;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [removing, setRemoving] = useState<Budget | null>(null);
  const editing = props.budgets.find((b) => b.id === draft.id);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    const input: BudgetInput = {
      ...(draft.id ? { id: draft.id } : {}),
      scope: draft.scope,
      ...(draft.scope === "project" ? { projectKey: draft.projectKey } : {}),
      period: draft.period,
      limitUsd: Number(draft.limitUsd),
      action: draft.action,
    };
    await store.setBudget(hostId, input);
    setDraft(EMPTY);
  };
  const needs = !(Number(draft.limitUsd) > 0)
    ? t("budgetsUi.limitNeeded")
    : draft.scope === "project" && draft.projectKey.trim() === ""
      ? t("budgetsUi.projectNeeded")
      : null;
  const title = t("budgetsUi.title", { host: props.hostName });
  return (
    <section aria-label={title}>
      <Panel title={title}>
        <Stack gap={4}>
          {props.budgets.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("budgetsUi.none")}</p>
          ) : (
            <Stack as="ul" gap={2}>
              {props.budgets.map((budget) => (
                <li key={budget.id}>
                  <ListRow
                    title={budgetLine(budget, t)}
                    trailing={
                      <Inline gap={1}>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("budgetsUi.edit", { label: budgetLabel(budget, t) })}
                          onClick={() =>
                            setDraft({
                              id: budget.id,
                              scope: budget.scope,
                              projectKey: budget.projectKey ?? "",
                              period: budget.period,
                              limitUsd: String(budget.limitUsd),
                              action: budget.action,
                            })
                          }
                        >
                          {t("budgetsUi.editShort")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("budgetsUi.remove", { label: budgetLabel(budget, t) })}
                          onClick={() => setRemoving(budget)}
                        >
                          {t("budgetsUi.removeShort")}
                        </Button>
                      </Inline>
                    }
                  />
                </li>
              ))}
            </Stack>
          )}
          <Form
            variant="inline"
            aria-label={
              editing ? t("budgetsUi.edit", { label: budgetLabel(editing, t) }) : t("budgetsUi.new")
            }
            onSubmit={() => void save()}
          >
            <Grid cols={{ base: 1, sm: 2 }} gap={4}>
              <Field label={t("budgetsUi.scope")}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={draft.scope}
                    onChange={(e) => set({ scope: e.target.value as Draft["scope"] })}
                  >
                    <option value="host">{t("budgetsUi.host")}</option>
                    <option value="project">{t("budgetsUi.project")}</option>
                  </NativeSelect>
                )}
              </Field>
              {draft.scope === "project" && (
                <Field label={t("budgetsUi.projectLabel")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.projectKey}
                      onChange={(e) => set({ projectKey: e.target.value })}
                    />
                  )}
                </Field>
              )}
              <Field label={t("budgetsUi.period")}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={draft.period}
                    onChange={(e) => set({ period: e.target.value as Draft["period"] })}
                  >
                    <option value="day">{t("budgets.day")}</option>
                    <option value="month">{t("budgets.month")}</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label={t("budgetsUi.limit")}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={0}
                    step="any"
                    value={draft.limitUsd}
                    onChange={(e) => set({ limitUsd: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label={t("budgetsUi.action")}
                help={t(draft.action === "queue" ? "budgetsUi.queueHelp" : "budgetsUi.notifyHelp")}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={draft.action}
                    onChange={(e) => set({ action: e.target.value as Draft["action"] })}
                  >
                    <option value="notify">{t("budgets.notify")}</option>
                    <option value="queue">{t("budgets.queue")}</option>
                  </NativeSelect>
                )}
              </Field>
            </Grid>
            <FormActions
              submit={t("budgetsUi.save")}
              disabled={needs !== null}
              disabledReason={needs}
              {...(editing
                ? { cancel: t("budgetsUi.cancelEdit"), onCancel: () => setDraft(EMPTY) }
                : {})}
            />
          </Form>
        </Stack>
      </Panel>
      {removing && (
        <ConfirmDialog
          message={t("budgetsUi.removeMessage", { label: budgetLabel(removing, t) })}
          confirmLabel={t("budgetsUi.removeConfirm")}
          destructive
          onConfirm={() => {
            void store.removeBudget(hostId, removing);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
