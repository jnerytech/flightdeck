import type { Automation, AutomationRun, WorkflowInfo } from "@flightdeck/protocol";
import { Plus, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMinLoading } from "@/hooks/use-min-loading";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { actionText, confirmOnText, triggerText } from "../lib/automations.ts";
import { AutomationForm } from "./AutomationForm.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const RUN_TONE: Record<AutomationRun["status"], string> = {
  ok: "text-status-idle",
  failed: "text-status-error",
  ignored: "text-muted-foreground",
  skipped: "text-muted-foreground",
  limited: "text-status-needs-you",
  missed: "text-status-needs-you",
};

function Runs(props: { store: AppStore; automation: Automation; runs: AutomationRun[] }) {
  const { store, automation } = props;
  const { t } = store.i18n;
  if (props.runs.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("automationsUi.noRuns")}</p>;
  }
  return (
    <ul
      aria-label={t("automationsUi.runs", { name: automation.name })}
      className="flex flex-col gap-1 text-xs"
    >
      {props.runs.map((run) => (
        <li key={run.id} className="flex flex-wrap items-baseline gap-x-2">
          <time dateTime={run.firedAt} className="text-muted-foreground tabular-nums">
            {store.formatDateTime(run.firedAt)}
          </time>
          <span>{run.cause}</span>
          <strong className={RUN_TONE[run.status]}>
            {t(`automationsUi.runStatus.${run.status}` as Key)}
          </strong>
          {run.detail && <span className="text-muted-foreground">{run.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A project's automations: the guided creation, turning one on (after showing what it will do),
 * the history of its firings, editing and removing.
 */
export function AutomationsPage(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  projectName: string;
}) {
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
  const loading = useMinLoading(automations === null);

  const load = useCallback(async () => {
    const [list, flows] = await Promise.all([
      store.hostCommand(hostId, "automation.list", { projectId }),
      store.hostCommand(hostId, "workflow.list", { projectId }),
    ]);
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
  const turnOff = async (automation: Automation) => {
    const updated = await store.hostCommand(hostId, "automation.toggle", {
      id: automation.id,
      enabled: false,
    });
    if (updated) replace(updated);
  };
  const turnOn = async (automation: Automation) => {
    setTurningOn(null);
    const updated = await store.hostCommand(hostId, "automation.toggle", {
      id: automation.id,
      enabled: true,
      confirm: true,
    });
    if (updated) replace(updated);
  };
  const remove = async (automation: Automation) => {
    setRemoving(null);
    const result = await store.hostCommand(hostId, "automation.remove", {
      id: automation.id,
      confirm: true,
    });
    if (result) setAutomations(result.automations);
  };
  const toggleHistory = async (automation: Automation) => {
    if (history[automation.id]) {
      const { [automation.id]: _closed, ...rest } = history;
      setHistory(rest);
      return;
    }
    const result = await store.hostCommand(hostId, "automation.runs", { id: automation.id });
    if (result) setHistory({ ...history, [automation.id]: result.runs });
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
        {loading && <LoadingState label={t("automationsUi.loading")} />}
        {automations?.length === 0 && (
          <EmptyState icon={Workflow} title={t("automationsUi.empty")} />
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
                    aria-label={t("automationsUi.turnOn", { name: automation.name })}
                    checked={automation.enabled}
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
                  <Button variant="ghost" size="sm" onClick={() => void toggleHistory(automation)}>
                    {t(
                      history[automation.id]
                        ? "automationsUi.hideHistory"
                        : "automationsUi.history",
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(automation)}>
                    {t("automationsUi.edit")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(automation)}>
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
