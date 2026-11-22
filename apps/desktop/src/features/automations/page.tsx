import type { Automation, AutomationRun, WorkflowInfo } from "@flightdeck/protocol";
import { Plus, Workflow } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, ErrorState, LoadingState, Page } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { AutomationForm } from "./automation-form.tsx";
import {
  actionText,
  causeText,
  confirmOnText,
  detailText,
  triggerText,
} from "./domain/automations.ts";

const RUN_TONE: Record<AutomationRun["status"], string> = {
  ok: "text-status-idle",
  failed: "text-status-error",
  ignored: "text-muted-foreground",
  skipped: "text-muted-foreground",
  limited: "text-status-needs-you",
  missed: "text-status-needs-you",
};

function Runs(props: Readonly<{ store: AppStore; automation: Automation; runs: AutomationRun[] }>) {
  const { store, automation } = props;
  const { t } = store.i18n;
  if (props.runs.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("automationsUi.noRuns")}</p>;
  }
  return (
    <ul
      aria-label={t("automationsUi.runs", { name: automation.name })}
      // A long history scrolls inside its row; the list takes the keyboard focus so it can be scrolled.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region has to be focusable (axe scrollable-region-focusable)
      tabIndex={0}
      className="flex max-h-64 flex-col gap-1 overflow-y-auto text-xs"
    >
      {props.runs.map((run) => (
        <li key={run.id} className="flex flex-wrap items-baseline gap-x-2">
          <time dateTime={run.firedAt} className="text-muted-foreground tabular-nums">
            {store.formatDateTime(run.firedAt)}
          </time>
          <span>{causeText(t, (iso) => store.formatDateTime(iso), run)}</span>
          <strong className={RUN_TONE[run.status]}>
            {t(`automationsUi.runStatus.${run.status}` as Key)}
          </strong>
          {run.detail && <span className="text-muted-foreground">{detailText(t, run)}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A project's automations: the guided creation, turning one on (after showing what it will do),
 * the history of its firings, editing and removing.
 */
export function AutomationsPage(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    projectName: string;
  }>,
) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  /** `"new"` for the creation, an automation for its editing. */
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const [turningOn, setTurningOn] = useState<Automation | null>(null);
  const [removing, setRemoving] = useState<Automation | null>(null);
  /** The firings of the automations whose history is open. */
  const [history, setHistory] = useState<Record<string, AutomationRun[]>>({});
  /** A load that the host refused: the page says which list and offers Try again. */
  const [failed, setFailed] = useState<"automations" | "workflows" | null>(null);
  const loading = useMinLoading(automations === null && failed === null);
  /** The requests in flight, as `<kind>:<id>`: a control waits for its answer before it sends again. */
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const guarded = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusy(new Set(inFlight.current));
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
      setBusy(new Set(inFlight.current));
    }
  };

  const load = useCallback(async () => {
    // The page has its own error and Try again (the toast's retry would drop the answer).
    const [list, flows] = await Promise.all([
      store.hostCommand(hostId, "automation.list", { projectId }, { retry: false }),
      store.hostCommand(hostId, "workflow.list", { projectId }, { retry: false }),
    ]);
    // Without the automations there is no list to show; without the workflows the list still works.
    setFailed(list === null ? "automations" : flows === null ? "workflows" : null);
    if (list) setAutomations(list.automations);
    if (flows) setWorkflows(flows.workflows);
  }, [store, hostId, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (automation: Automation) =>
    setAutomations((list) =>
      (list ?? []).some((a) => a.id === automation.id)
        ? (list ?? []).map((a) => (a.id === automation.id ? automation : a))
        : [...(list ?? []), automation],
    );
  const turnOff = (automation: Automation) =>
    guarded(`toggle:${automation.id}`, async () => {
      const updated = await store.hostCommand(hostId, "automation.toggle", {
        id: automation.id,
        enabled: false,
      });
      if (updated) replace(updated);
    });
  const turnOn = (automation: Automation) => {
    setTurningOn(null);
    return guarded(`toggle:${automation.id}`, async () => {
      const updated = await store.hostCommand(hostId, "automation.toggle", {
        id: automation.id,
        enabled: true,
        confirm: true,
      });
      if (updated) replace(updated);
    });
  };
  const remove = (automation: Automation) => {
    setRemoving(null);
    return guarded(`remove:${automation.id}`, async () => {
      const result = await store.hostCommand(hostId, "automation.remove", {
        id: automation.id,
        confirm: true,
      });
      if (result) setAutomations(result.automations);
    });
  };
  const toggleHistory = (automation: Automation) => {
    if (history[automation.id]) {
      setHistory(({ [automation.id]: _closed, ...rest }) => rest);
      return Promise.resolve();
    }
    return guarded(`history:${automation.id}`, async () => {
      const result = await store.hostCommand(hostId, "automation.runs", { id: automation.id });
      // The latest state, not the one this press saw: two answers in flight must not drop each other.
      if (result) setHistory((now) => ({ ...now, [automation.id]: result.runs }));
    });
  };

  return (
    <Page
      title={t("automationsUi.title", { project: props.projectName })}
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          {t("automationsUi.new")}
        </Button>
      }
    >
      <div className="flex max-w-3xl flex-col gap-3">
        {failed && (
          <ErrorState
            message={t(
              failed === "workflows" ? "automationsUi.failedWorkflows" : "automationsUi.failed",
            )}
            retryLabel={t("automationsUi.retry")}
            onRetry={() => void load()}
          />
        )}
        {loading && <LoadingState label={t("automationsUi.loading")} />}
        {automations?.length === 0 && (
          <EmptyState
            icon={Workflow}
            title={t("automationsUi.empty")}
            action={
              <Button onClick={() => setEditing("new")}>{t("automationsUi.emptyAction")}</Button>
            }
          />
        )}
        <ul aria-label={t("automationsUi.list")} className="flex flex-col gap-2">
          {(automations ?? []).map((automation) => (
            <li
              key={automation.id}
              aria-label={t("automationsUi.row", { name: automation.name })}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <strong className="font-medium">{automation.name}</strong>
                  <span className="text-muted-foreground text-xs">
                    {triggerText(t, automation.trigger)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {actionText(t, automation.action)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={automation.enabled ? "text-status-idle" : "text-muted-foreground"}
                  >
                    {t(automation.enabled ? "automationsUi.on" : "automationsUi.off")}
                  </span>
                  <Switch
                    aria-label={t("automationsUi.row", { name: automation.name })}
                    checked={automation.enabled}
                    disabled={busy.has(`toggle:${automation.id}`)}
                    onCheckedChange={(on) =>
                      on ? setTurningOn(automation) : void turnOff(automation)
                    }
                  />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {t("automationsUi.limit", { n: automation.maxRunsPerDay })}
                </Badge>
                {automation.allowExternalAuthors && (
                  <Badge variant="outline" className="text-status-needs-you">
                    {t("automationsUi.externalAuthors")}
                  </Badge>
                )}
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={history[automation.id] !== undefined}
                    aria-label={t(
                      history[automation.id]
                        ? "automationsUi.hideHistoryOf"
                        : "automationsUi.historyOf",
                      { name: automation.name },
                    )}
                    disabled={busy.has(`history:${automation.id}`)}
                    onClick={() => void toggleHistory(automation)}
                  >
                    {t(
                      history[automation.id]
                        ? "automationsUi.hideHistory"
                        : "automationsUi.history",
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("automationsUi.editOf", { name: automation.name })}
                    onClick={() => setEditing(automation)}
                  >
                    {t("automationsUi.edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("automationsUi.removeOf", { name: automation.name })}
                    disabled={busy.has(`remove:${automation.id}`)}
                    onClick={() => setRemoving(automation)}
                  >
                    {t("automationsUi.remove")}
                  </Button>
                </span>
              </div>
              {history[automation.id] && (
                <Runs store={store} automation={automation} runs={history[automation.id] ?? []} />
              )}
            </li>
          ))}
        </ul>
      </div>
      {editing && (
        <AutomationForm
          store={store}
          hostId={hostId}
          projectId={projectId}
          workflows={workflows}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            replace(saved);
            setEditing(null);
          }}
        />
      )}
      {turningOn && (
        <ConfirmDialog
          message={confirmOnText(t, turningOn)}
          warning={turningOn.allowExternalAuthors ? t("automationsUi.confirmOnExternal") : null}
          confirmLabel={t("automationsUi.confirmOnLabel")}
          onConfirm={() => void turnOn(turningOn)}
          onCancel={() => setTurningOn(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          message={t("automationsUi.removeMessage", { name: removing.name })}
          confirmLabel={t("automationsUi.remove")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  );
}
