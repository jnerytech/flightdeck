import type { Budget, BudgetInput, QuotaBudgetInput } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { ListRow } from "@/components/layout/list-row";
import { Panel } from "@/components/layout/panel";
import { Grid, Inline, Stack } from "@/components/layout/stack";
import { Meter } from "@/components/status/meter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { hasFeature } from "@/lib/version";
import type { AppStore } from "../lib/app-store.ts";
import { budgetLabel, budgetLine, projectName } from "../lib/budgets.ts";
import { periodRange } from "../lib/costs.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** What the client filter reads: the selection, the clients and where each project belongs. */
const BUDGETS_KEYS = [
  "clientSelection",
  "clientList",
  "clientOverrides",
  "projects",
  "hosts",
] as const;

interface Draft {
  id?: string;
  scope: Budget["scope"];
  projectKey: string;
  /** The project is one the list does not have: its key is typed. */
  other: boolean;
  /** What the limit is measured in: dollars, or a share of a plan quota window (issue #1248). */
  unit: "usd" | QuotaBudgetInput["window"];
  period: BudgetInput["period"];
  limitUsd: string;
  /** The share of the window, in percent as typed. */
  limitPct: string;
  action: Budget["action"];
}

/** The fraction of the limit from which a budget's bar turns red. */
const HOT_FROM = 0.8;

/** The value of the list entry that opens the key field. */
const OTHER = "__other__";

const EMPTY: Draft = {
  scope: "host",
  projectKey: "",
  other: false,
  unit: "usd",
  period: "day",
  limitUsd: "",
  limitPct: "",
  action: "notify",
};

/** The smallest share the daemon takes, in percent. */
const MIN_PCT = 0.1;

/** A host's budgets with what each one spent in its period, and a form to create or edit one. */
export function BudgetsSection(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
    budgets: Budget[];
  }>,
) {
  const t = useT();
  const { store, hostId } = props;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [removing, setRemoving] = useState<Budget | null>(null);
  const saving = useBusy();
  const { budgets } = props;
  const editing = budgets.find((b) => b.id === draft.id);
  // The selected client's project budgets, and the host's own, which cap everything on the host.
  const scope = store.clientScope();
  const { clientSelection: selection, hosts } = useStoreSlice(store, BUDGETS_KEYS);
  // A host that runs the quota can measure a budget in a share of its plan window.
  const byWindow = hasFeature(
    hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "quotaBudgets",
    false,
  );
  const visible = budgets.filter(
    (b) => b.scope === "host" || scope.includes(selection, b.projectKey ?? ""),
  );
  const hidden = budgets.length - visible.length;
  const [spentOn, setSpentOn] = useState<string[]>([]);
  // The keys a project budget can name are the ones the host has seen: those with usage in the
  // last 30 days and those a budget already uses.
  useEffect(() => {
    void store
      .hostCommand(hostId, "costs.summary", periodRange("30d", store.today()))
      .then((summary) => summary && setSpentOn(summary.byProject.map((p) => p.projectKey)));
  }, [store, hostId]);
  const keys = [
    ...new Set([
      ...spentOn,
      ...budgets.flatMap((b) => (b.projectKey ? [b.projectKey] : [])),
      ...(draft.projectKey ? [draft.projectKey] : []),
    ]),
  ];
  const projects = keys
    .map((key) => {
      const name = projectName(key);
      const shared = keys.filter((other) => projectName(other) === name).length > 1;
      return { key, label: shared ? `${name} · ${key}` : name };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    const common = {
      ...(draft.id ? { id: draft.id } : {}),
      scope: draft.scope,
      ...(draft.scope === "project" ? { projectKey: draft.projectKey } : {}),
      action: draft.action,
    };
    if (draft.unit === "usd") {
      await store.setBudget(hostId, {
        ...common,
        period: draft.period,
        limitUsd: Number(draft.limitUsd),
      });
    } else {
      await store.setQuotaBudget(hostId, {
        ...common,
        window: draft.unit,
        limitPct: Number(draft.limitPct) / 100,
      });
    }
    setDraft(EMPTY);
  };
  const byShare = draft.unit !== "usd";
  const limit = Number(byShare ? draft.limitPct : draft.limitUsd);
  let needs: string | null = null;
  if (byShare && (draft.limitPct.trim() === "" || !(limit >= MIN_PCT && limit <= 100))) {
    needs = t("budgetsUi.pctNeeded");
  } else if (Number.isNaN(limit) || limit <= 0) needs = t("budgetsUi.limitNeeded");
  else if (draft.scope === "project" && draft.projectKey.trim() === "") {
    needs = t("budgetsUi.projectNeeded");
  }
  const title = t("budgetsUi.title", { host: props.hostName });
  return (
    <section aria-label={title}>
      <Panel title={title}>
        <Stack gap={4}>
          {budgets.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("budgetsUi.none")}</p>
          ) : (
            <Stack as="ul" gap={2}>
              {visible.map((budget) => (
                <li key={budget.id}>
                  <Stack gap={1}>
                    <ListRow
                      title={
                        <span
                          className="whitespace-normal break-words"
                          title={budget.projectKey ?? undefined}
                        >
                          {budgetLine(budget, t)}
                        </span>
                      }
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
                                other: false,
                                unit:
                                  budget.limitPct === null
                                    ? "usd"
                                    : (budget.period as Draft["unit"]),
                                period: budget.period === "month" ? "month" : "day",
                                limitUsd: budget.limitPct === null ? String(budget.limitUsd) : "",
                                limitPct:
                                  budget.limitPct === null
                                    ? ""
                                    : String(Math.round(budget.limitPct * 1000) / 10),
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
                    <Meter
                      label={t("budgetsUi.meter", {
                        label: budgetLabel(budget, t),
                        percent: Math.round(budget.fraction * 100),
                      })}
                      value={Math.min(budget.fraction, 1)}
                      max={1}
                      hot={budget.fraction >= HOT_FROM}
                      className="w-full"
                    />
                  </Stack>
                </li>
              ))}
            </Stack>
          )}
          {hidden > 0 && (
            <p className="text-muted-foreground text-sm">
              {hidden === 1
                ? t("clients.budgetsHiddenOne")
                : t("clients.budgetsHiddenMany", { count: hidden })}
            </p>
          )}
          <Form
            variant="inline"
            aria-label={
              editing ? t("budgetsUi.edit", { label: budgetLabel(editing, t) }) : t("budgetsUi.new")
            }
            onSubmit={() => saving.run(save)}
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
                  {(control) =>
                    projects.length === 0 ? (
                      <Input
                        {...control}
                        value={draft.projectKey}
                        onChange={(e) => set({ projectKey: e.target.value })}
                      />
                    ) : (
                      <NativeSelect
                        {...control}
                        value={draft.other ? OTHER : draft.projectKey}
                        onChange={(e) =>
                          set(
                            e.target.value === OTHER
                              ? { other: true, projectKey: "" }
                              : { other: false, projectKey: e.target.value },
                          )
                        }
                      >
                        <option value="">{t("budgetsUi.pickProject")}</option>
                        {projects.map((project) => (
                          <option key={project.key} value={project.key}>
                            {project.label}
                          </option>
                        ))}
                        <option value={OTHER}>{t("budgetsUi.otherProject")}</option>
                      </NativeSelect>
                    )
                  }
                </Field>
              )}
              {draft.scope === "project" && draft.other && (
                <Field label={t("budgetsUi.keyLabel")} help={t("budgetsUi.keyHelp")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.projectKey}
                      onChange={(e) => set({ projectKey: e.target.value })}
                    />
                  )}
                </Field>
              )}
              {(byWindow || byShare) && (
                <Field label={t("budgetsUi.unit")}>
                  {(control) => (
                    <NativeSelect
                      {...control}
                      value={draft.unit}
                      onChange={(e) => set({ unit: e.target.value as Draft["unit"] })}
                    >
                      <option value="usd">{t("budgetsUi.unitUsd")}</option>
                      <option value="five_hour">{t("budgetsUi.unitFiveHour")}</option>
                      <option value="seven_day">{t("budgetsUi.unitSevenDay")}</option>
                    </NativeSelect>
                  )}
                </Field>
              )}
              {!byShare && (
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
              )}
              {byShare ? (
                <Field
                  label={t("budgetsUi.limitPct")}
                  help={draft.scope === "project" ? t("budgetsUi.estimateHelp") : undefined}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      min={MIN_PCT}
                      max={100}
                      step="any"
                      value={draft.limitPct}
                      onChange={(e) => set({ limitPct: e.target.value })}
                    />
                  )}
                </Field>
              ) : (
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
              )}
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
              submit={t(editing ? "budgetsUi.save" : "budgetsUi.create")}
              busy={saving.busy}
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
