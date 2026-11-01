import type { ActionInfo, ActionList, ActionRunInfo } from "@flightdeck/protocol";
import { Plus, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMinLoading } from "@/hooks/use-min-loading";
import { actionIssueText } from "../i18n/errors.ts";
import type { T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import type { ActionSeed } from "../lib/snippets.ts";
import { isProd } from "../lib/ssh.ts";
import type { SecretMeta } from "../lib/vault.ts";
import { ActionForm } from "./ActionForm.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** Where the action runs, in words: this host, a named one or an SSH destination. */
function whereText(t: T, action: ActionInfo): string {
  if (action.ssh) return t("actionsUi.ssh", { destination: action.ssh });
  if (action.host) return t("actionsUi.onHost", { host: action.host });
  return t("actionsUi.here");
}

/** Whether the action uses a vault secret tagged as production. */
function usesProdSecret(action: ActionInfo, secrets: SecretMeta[]): boolean {
  const ids = new Set([...action.secrets.values, ...action.secrets.files]);
  return secrets.some((s) => ids.has(s.id) && isProd(s.tags));
}

/** One action's runs, newest first; the output is shown as the daemon masked it. */
function Runs(props: { store: AppStore; action: ActionInfo; runs: ActionRunInfo[] }) {
  const { store, action } = props;
  const { t } = store.i18n;
  if (props.runs.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("actionsUi.noRuns")}</p>;
  }
  return (
    <ul aria-label={t("actionsUi.runs", { name: action.name })} className="flex flex-col gap-2">
      {props.runs.map((run) => (
        <li key={run.id} className="flex flex-col gap-1 text-xs">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <time dateTime={run.startedAt} className="text-muted-foreground tabular-nums">
              {store.formatDateTime(run.startedAt)}
            </time>
            <span>{t(`actionsUi.requester.${run.requestedBy}`)}</span>
            <strong className={run.exitCode === 0 ? "text-status-idle" : "text-status-error"}>
              {t("actionsUi.exit", { code: run.exitCode })}
            </strong>
            <span className="text-muted-foreground tabular-nums">
              {(run.durationMs / 1000).toFixed(1)} s
            </span>
            {run.timedOut && <span>{t("actionsUi.timedOut")}</span>}
            {run.truncated && <span>{t("actionsUi.truncated")}</span>}
          </span>
          {run.output && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono">
              {run.output}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A project's actions: the commands that use a vault secret without Claude seeing it, each with
 * where it runs, how it asks for approval, the secrets it uses and its parameters.
 */
/** The problems of the actions file in the app's language; an older host sends only its text. */
const problemsOf = (list: ActionList, t: T): string[] =>
  list.issues ? list.issues.map((issue) => actionIssueText(issue, t)) : list.errors;

export function ActionsPage(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  projectName: string;
  /** Opens the form on a new action filled from a snippet (phase 18). */
  draft?: ActionSeed | undefined;
}) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const [actions, setActions] = useState<ActionInfo[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  /** The runs of the actions whose history is open, by `source:name`. */
  const [history, setHistory] = useState<Record<string, ActionRunInfo[]>>({});
  const [trusting, setTrusting] = useState<ActionInfo | null>(null);
  /** `"new"` for the creation, an action made in the app for its editing. */
  const [editing, setEditing] = useState<ActionInfo | "new" | null>(props.draft ? "new" : null);
  const [removing, setRemoving] = useState<ActionInfo | null>(null);
  const loading = useMinLoading(actions === null);

  const load = useCallback(async () => {
    const list = await store.hostCommand(hostId, "actions.list", { projectId });
    if (!list) return;
    setActions(list.actions);
    setErrors(problemsOf(list, t));
  }, [store, hostId, projectId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleRuns = async (action: ActionInfo) => {
    const key = `${action.source}:${action.name}`;
    if (history[key]) {
      const { [key]: _closed, ...rest } = history;
      setHistory(rest);
      return;
    }
    const result = await store.hostCommand(hostId, "actions.runs", {
      projectId,
      name: action.name,
    });
    if (result) setHistory({ ...history, [key]: result.runs });
  };
  const remove = async (action: ActionInfo) => {
    setRemoving(null);
    const result = await store.hostCommand(hostId, "actions.remove", {
      projectId,
      name: action.name,
    });
    if (result) {
      setActions(result.actions);
      setErrors(problemsOf(result, t));
    }
  };
  const trust = async (action: ActionInfo) => {
    setTrusting(null);
    const updated = await store.hostCommand(hostId, "actions.trust", {
      projectId,
      name: action.name,
      hash: action.hash,
    });
    if (updated) {
      setActions((list) =>
        (list ?? []).map((a) =>
          a.name === updated.name && a.source === updated.source ? updated : a,
        ),
      );
    }
  };

  return (
    <Page
      title={t("actionsUi.title", { project: props.projectName })}
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          {t("actionsUi.new")}
        </Button>
      }
    >
      <div className="flex max-w-3xl flex-col gap-3">
        <p role="note" className="text-muted-foreground text-xs">
          {t("actionsUi.sameUser")}
        </p>
        {loading && <LoadingState label={t("actionsUi.loading")} />}
        {actions?.length === 0 && (
          <EmptyState
            icon={Terminal}
            title={t("actionsUi.empty")}
            action={<Button onClick={() => setEditing("new")}>{t("actionsUi.emptyAction")}</Button>}
          />
        )}
        {errors.length > 0 && (
          <ul
            aria-label={t("actionsUi.problems")}
            className="flex flex-col gap-1 text-status-error text-xs"
          >
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <ul aria-label={t("actionsUi.list")} className="flex flex-col gap-2">
          {(actions ?? []).map((action) => {
            const secrets = [...action.secrets.values, ...action.secrets.files];
            const params = Object.keys(action.params);
            const key = `${action.source}:${action.name}`;
            const prodHere = !action.ssh && usesProdSecret(action, store.getState().secrets);
            return (
              <li
                key={key}
                aria-label={t("actionsUi.row", { name: action.name })}
                className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm"
              >
                <strong className="font-medium">{action.name}</strong>
                <span className="text-muted-foreground text-xs">{action.description}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{whereText(t, action)}</Badge>
                  <Badge variant="outline">{t(`actionsUi.approval.${action.approval}`)}</Badge>
                  <Badge variant="outline">{t(`actionsUi.source.${action.source}`)}</Badge>
                  <Badge
                    variant="outline"
                    className={action.trusted ? "text-status-idle" : "text-status-needs-you"}
                  >
                    {t(action.trusted ? "actionsUi.trusted" : "actionsUi.notTrusted")}
                  </Badge>
                </div>
                {secrets.length > 0 && (
                  <span className="text-xs">
                    {t("actionsUi.secrets", { names: secrets.join(", ") })}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  aria-label={t(history[key] ? "actionsUi.hideRuns" : "actionsUi.showRuns", {
                    name: action.name,
                  })}
                  onClick={() => void toggleRuns(action)}
                >
                  {t(history[key] ? "actionsUi.hideRunsButton" : "actionsUi.runsButton")}
                </Button>
                {history[key] && <Runs store={store} action={action} runs={history[key] ?? []} />}
                {action.source === "app" && (
                  <span className="flex gap-1 self-start">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("actionsUi.edit", { name: action.name })}
                      onClick={() => setEditing(action)}
                    >
                      {t("actionsUi.editButton")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("actionsUi.remove", { name: action.name })}
                      onClick={() => setRemoving(action)}
                    >
                      {t("actionsUi.removeButton")}
                    </Button>
                  </span>
                )}
                {prodHere && (
                  <span className="text-status-needs-you text-xs">{t("actionsUi.prodHere")}</span>
                )}
                {action.changed.length > 0 && (
                  <span className="text-status-needs-you text-xs">
                    {t("actionsUi.changedSince", { what: action.changed.join(", ") })}
                  </span>
                )}
                {!action.trusted && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setTrusting(action)}
                  >
                    {t("actionsUi.trust", { name: action.name })}
                  </Button>
                )}
                {params.length > 0 && (
                  <span className="text-xs">
                    {t("actionsUi.params", { names: params.join(", ") })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {editing && (
        <ActionForm
          store={store}
          hostId={hostId}
          projectId={projectId}
          initial={editing === "new" ? null : editing}
          {...(editing === "new" && props.draft ? { seed: props.draft } : {})}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setActions((list) => [
              ...(list ?? []).filter((a) => !(a.name === saved.name && a.source === saved.source)),
              saved,
            ]);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          message={t("actionsUi.removeMessage", { name: removing.name })}
          confirmLabel={t("actionsUi.removeButton")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
      {trusting && (
        <ConfirmDialog
          message={`${t("actionsUi.trustMessage", { name: trusting.name, run: trusting.run.join(" ") })}${
            trusting.changed.length > 0
              ? ` ${t("actionsUi.changedSince", { what: trusting.changed.join(", ") })}.`
              : ""
          }`}
          confirmLabel={t("actionsUi.trustLabel")}
          onConfirm={() => void trust(trusting)}
          onCancel={() => setTrusting(null)}
        />
      )}
    </Page>
  );
}
