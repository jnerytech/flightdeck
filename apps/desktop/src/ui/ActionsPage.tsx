import type { ActionInfo } from "@flightdeck/protocol";
import { Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { useMinLoading } from "@/hooks/use-min-loading";
import type { T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";

/** Where the action runs, in words: this host, a named one or an SSH destination. */
function whereText(t: T, action: ActionInfo): string {
  if (action.ssh) return t("actionsUi.ssh", { destination: action.ssh });
  if (action.host) return t("actionsUi.onHost", { host: action.host });
  return t("actionsUi.here");
}

/**
 * A project's actions: the commands that use a vault secret without Claude seeing it, each with
 * where it runs, how it asks for approval, the secrets it uses and its parameters.
 */
export function ActionsPage(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  projectName: string;
}) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const [actions, setActions] = useState<ActionInfo[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const loading = useMinLoading(actions === null);

  const load = useCallback(async () => {
    const list = await store.hostCommand(hostId, "actions.list", { projectId });
    if (!list) return;
    setActions(list.actions);
    setErrors(list.errors);
  }, [store, hostId, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page title={t("actionsUi.title", { project: props.projectName })}>
      <div className="flex max-w-3xl flex-col gap-3">
        {loading && <LoadingState label={t("actionsUi.loading")} />}
        {actions?.length === 0 && <EmptyState icon={Terminal} title={t("actionsUi.empty")} />}
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
            return (
              <li
                key={`${action.source}:${action.name}`}
                aria-label={t("actionsUi.row", { name: action.name })}
                className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm"
              >
                <strong className="font-medium">{action.name}</strong>
                <span className="text-muted-foreground text-xs">{action.description}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{whereText(t, action)}</Badge>
                  <Badge variant="outline">{t(`actionsUi.approval.${action.approval}`)}</Badge>
                  <Badge variant="outline">{t(`actionsUi.source.${action.source}`)}</Badge>
                </div>
                {secrets.length > 0 && (
                  <span className="text-xs">
                    {t("actionsUi.secrets", { names: secrets.join(", ") })}
                  </span>
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
    </Page>
  );
}
