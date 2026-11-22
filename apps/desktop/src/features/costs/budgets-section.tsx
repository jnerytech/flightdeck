import type { Budget } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { hasFeature } from "@/lib/version";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { useBusy } from "@/shared/hooks/index.ts";
import {
  Field,
  Form,
  FormActions,
  Grid,
  Inline,
  ListRow,
  NativeSelect,
  Panel,
  Stack,
} from "@/shared/layout/index.ts";
import { Meter } from "@/shared/status/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import type { AppStore, HostResult } from "../../lib/app-store.ts";
import { type Draft, draftOf, EMPTY, MIN_PCT, missingOf } from "./domain/budget-draft.ts";
import { budgetLabel, budgetLine, budgetsSharingName, projectName } from "./domain/budgets.ts";
import { periodRange } from "./domain/costs.ts";

/** What the client filter reads: the selection, the clients and where each project belongs. */
const BUDGETS_KEYS = [
  "clientSelection",
  "clientList",
  "clientOverrides",
  "projects",
  "hosts",
] as const;

/** The fraction of the limit from which a budget's bar turns red. */
const HOT_FROM = 0.8;

/** The value of the list entry that opens the key field. */
const OTHER = "__other__";

/** Where the focus goes once a change is on screen: the pressed control may be gone (#3613). */
type AfterFocus =
  | { kind: "form" }
  | { kind: "edit"; id: string }
  | { kind: "gone"; id: string; next: string | null };

/** The element the focus goes to, or null while the list has not caught up with the change. */
function focusTarget(
  root: HTMLElement | null,
  focus: AfterFocus,
  budgets: readonly Budget[],
): HTMLElement | null {
  if (!root) return null;
  const firstField = () => root.querySelector<HTMLElement>("form select, form input");
  const editOf = (id: string) =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-budget]"))
      .find((row) => row.dataset.budget === id)
      ?.querySelector<HTMLElement>('[data-action="edit"]') ?? null;
  if (focus.kind === "form") return firstField();
  if (focus.kind === "edit") return editOf(focus.id);
  // A removed budget's row is gone once the host's answer is in the list.
  if (budgets.some((b) => b.id === focus.id)) return null;
  return (focus.next ? editOf(focus.next) : null) ?? firstField();
}

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
  const rootRef = useRef<HTMLElement>(null);
  /** What the last change did: a polite line on the section, not silence (#3613). */
  const [done, setDone] = useState<string | null>(null);
  const [focus, setFocus] = useState<AfterFocus | null>(null);
  /** Why the host's projects could not be listed; null while they could, or before the answer. */
  const [lookupFailed, setLookupFailed] = useState<Extract<
    HostResult<unknown>,
    { ok: false }
  > | null>(null);
  const editing = budgets.find((b) => b.id === draft.id);
  // The selected client's project budgets, and the host's own, which cap everything on the host.
  const scope = store.clientScope.get();
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
  const sameName = budgetsSharingName(visible);
  const [spentOn, setSpentOn] = useState<string[]>([]);
  // The keys a project budget can name are the ones the host has seen: those with usage in the
  // last 30 days and those a budget already uses.
  useEffect(() => {
    let live = true;
    setLookupFailed(null);
    setDone(null);
    setFocus(null);
    void (async () => {
      let result: HostResult<{ byProject: { projectKey: string }[] }>;
      try {
        result = await store.hostRequest(
          hostId,
          "costs.summary",
          periodRange("30d", store.today()),
        );
      } catch (error) {
        result = {
          ok: false,
          code: "internal",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (!live) return;
      if (result.ok) {
        setLookupFailed(null);
        setSpentOn(result.data.byProject.map((p) => p.projectKey));
      } else setLookupFailed(result);
    })();
    return () => {
      live = false;
    };
  }, [store, hostId]);
  // The closing dialog hands the focus back in a timeout of its own: this one comes after it.
  useEffect(() => {
    if (!focus) return;
    const target = focusTarget(rootRef.current, focus, visible);
    if (!target) {
      // A row the list does not show will not appear later: drop the request. A removed row may still be leaving.
      if (focus.kind !== "gone") setFocus(null);
      return;
    }
    const timer = setTimeout(() => {
      target.focus();
      setFocus(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [focus, visible]);
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
    const took =
      draft.unit === "usd"
        ? await store.budgets.set(hostId, {
            ...common,
            period: draft.period,
            limitUsd: Number(draft.limitUsd),
          })
        : await store.budgets.setQuota(hostId, {
            ...common,
            window: draft.unit,
            limitPct: Number(draft.limitPct) / 100,
          });
    // A refusal keeps the form as it was: the toast says why.
    if (!took) return;
    const label = budgetLabel(
      {
        scope: draft.scope,
        projectKey: draft.scope === "project" ? draft.projectKey : null,
        period: draft.unit === "usd" ? draft.period : draft.unit,
      },
      t,
    );
    setDone(t(draft.id ? "budgetsUi.done.saved" : "budgetsUi.done.created", { label }));
    setFocus(draft.id ? { kind: "edit", id: draft.id } : { kind: "form" });
    setDraft(EMPTY);
  };
  const byShare = draft.unit !== "usd";
  const needs = missingOf(draft, t);
  const title = t("budgetsUi.title", { host: props.hostName });
  return (
    <section ref={rootRef} aria-label={title}>
      <Panel title={title}>
        <Stack gap={4}>
          {done && <InlineNotice tone="info">{done}</InlineNotice>}
          {lookupFailed && (
            <InlineNotice tone="error">
              {t("budgetsUi.projectsFailed", {
                reason: refusalText(lookupFailed.code, lookupFailed.message, t, lookupFailed),
              })}
            </InlineNotice>
          )}
          {budgets.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("budgetsUi.none")}</p>
          ) : (
            <Stack as="ul" gap={2}>
              {visible.map((budget) => (
                <li key={budget.id} data-budget={budget.id}>
                  <Stack gap={1}>
                    <ListRow
                      title={
                        <span
                          className="whitespace-normal break-words"
                          title={budget.projectKey ?? undefined}
                        >
                          {budgetLine(budget, t)}
                          {sameName.has(budget.id) && (
                            <span className="block text-muted-foreground text-xs">
                              {budget.projectKey}
                            </span>
                          )}
                        </span>
                      }
                      trailing={
                        <Inline gap={1}>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("budgetsUi.edit", { label: budgetLabel(budget, t) })}
                            data-action="edit"
                            onClick={() => {
                              setDraft(draftOf(budget));
                              setFocus({ kind: "form" });
                            }}
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
                <Field
                  label={t("budgetsUi.projectLabel")}
                  {...(projects.length === 0 ? { help: t("budgetsUi.keyHelp") } : {})}
                >
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
          onConfirm={async () => {
            const gone = removing;
            setRemoving(null);
            if (!(await store.budgets.remove(hostId, gone))) return;
            const at = visible.findIndex((b) => b.id === gone.id);
            // A budget the list does not show (the client changed meanwhile) leaves the focus where it is.
            const next = at < 0 ? undefined : (visible[at + 1] ?? visible[at - 1]);
            setDone(t("budgetsUi.done.removed", { label: budgetLabel(gone, t) }));
            setFocus({ kind: "gone", id: gone.id, next: next?.id ?? null });
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
