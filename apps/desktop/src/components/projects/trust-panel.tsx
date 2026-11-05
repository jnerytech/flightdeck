import type { ProjectLoad, ProjectTrustState } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

type Loaded = { state: ProjectTrustState; load: ProjectLoad } | "failed" | null;

/**
 * Whether a project's own hooks, MCP servers, settings, agents and skills may load into a session
 * (issue #196): what the project would load, read without running anything, what not trusting costs,
 * and the decision. Trusting asks first; revoking does not. Hidden on a host that does not announce it.
 */
export function TrustPanel(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  projectName: string;
  path: string;
}) {
  const { store, hostId, path } = props;
  const { t } = store.i18n;
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [asking, setAsking] = useState(false);

  const read = useCallback(async () => {
    const [states, load] = await Promise.all([
      store.hostCommand(hostId, "project.trust.state", { paths: [path] }),
      store.hostCommand(hostId, "project.trust.inspect", { path }),
    ]);
    const state = states?.items[0];
    setLoaded(state && load ? { state, load } : "failed");
  }, [store, hostId, path]);

  useEffect(() => {
    void read();
  }, [read]);

  const decide = async (target: string, trusted: boolean) => {
    await store.hostCommand(hostId, "project.trust.set", { path: target, trusted });
    await read();
  };

  if (loaded === null) return null;
  if (loaded === "failed") {
    return (
      <Panel title={t("projectPage.trust.title")} label={t("projectPage.trust.title")}>
        <p className="text-sm">{t("projectPage.trust.failed")}</p>
      </Panel>
    );
  }
  const { state, load } = loaded;
  const groups: Array<[string, string[]]> = [
    [
      t("projectPage.trust.hooks"),
      load.hooks.flatMap((h) => h.commands.map((c) => `${h.event}: ${c}`)),
    ],
    [t("projectPage.trust.mcp"), load.mcpServers.map((s) => `${s.name}: ${s.command}`)],
    [t("projectPage.trust.env"), load.envKeys],
    [t("projectPage.trust.allow"), load.allowRules],
    [t("projectPage.trust.agents"), load.agents],
    [t("projectPage.trust.skills"), load.skills],
    [t("projectPage.trust.commands"), load.commands],
    [t("projectPage.trust.claudeMd"), load.claudeMd ? ["CLAUDE.md"] : []],
    [t("projectPage.trust.unreadable"), load.unreadable],
  ];
  const shown = groups.filter(([, items]) => items.length > 0);
  return (
    <Panel title={t("projectPage.trust.title")} label={t("projectPage.trust.title")}>
      <p className="text-muted-foreground text-xs">{t("projectPage.trust.hint")}</p>
      <p className="font-medium text-sm">
        {state.trusted
          ? state.via && state.via !== state.path
            ? t("projectPage.trust.trustedVia", { path: state.via })
            : t("projectPage.trust.trusted")
          : t("projectPage.trust.untrusted")}
      </p>
      {!state.trusted && <p className="text-sm">{t("projectPage.trust.cost")}</p>}
      <h3 className="font-medium text-sm">{t("projectPage.trust.listing")}</h3>
      {shown.length === 0 ? (
        <p className="text-sm">{t("projectPage.trust.nothing")}</p>
      ) : (
        <dl className="stack-hair text-sm">
          {shown.map(([title, items]) => (
            <div key={title}>
              <dt className="font-medium">{title}</dt>
              <dd>
                <ul>
                  {items.map((item) => (
                    <li key={item} className="font-mono text-xs">
                      {item}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div>
        {state.trusted ? (
          <ActionButton variant="outline" onClick={() => decide(state.via ?? path, false)}>
            {t("projectPage.trust.revoke")}
          </ActionButton>
        ) : (
          <ActionButton variant="outline" onClick={() => setAsking(true)}>
            {t("projectPage.trust.action")}
          </ActionButton>
        )}
      </div>
      {asking && (
        <ConfirmDialog
          destructive
          message={t("projectPage.trust.confirm", {
            project: props.projectName,
            host: props.hostName,
          })}
          confirmLabel={t("projectPage.trust.action")}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void decide(path, true);
          }}
        />
      )}
    </Panel>
  );
}
