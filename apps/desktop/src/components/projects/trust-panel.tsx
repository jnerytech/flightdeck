import type { ProjectLoad, ProjectTrustState } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** Past this many characters a listed command is shown in a block of its own. */
const LONG_LINE = 300;

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
  const more = (n: number) => (n > 0 ? [t("projectPage.trust.omitted", { n })] : []);
  const groups: Array<[string, string[]]> = [
    [
      t("projectPage.trust.hooks"),
      [
        ...load.hooks.flatMap((h) => h.commands.map((c) => `${h.event}: ${c}`)),
        ...more(load.omitted.hooks),
      ],
    ],
    [
      t("projectPage.trust.mcp"),
      [...load.mcpServers.map((s) => `${s.name}: ${s.command}`), ...more(load.omitted.mcpServers)],
    ],
    [t("projectPage.trust.programs"), load.executables.map((e) => `${e.key}: ${e.command}`)],
    [t("projectPage.trust.env"), [...load.envKeys, ...more(load.omitted.envKeys)]],
    [t("projectPage.trust.redirects"), load.redirects.map((r) => `${r.key} = ${r.value}`)],
    [t("projectPage.trust.plugins"), load.plugins],
    [t("projectPage.trust.otherKeys"), load.otherKeys],
    [t("projectPage.trust.extras"), load.extras.map((x) => `${x.file}: ${x.keys.join(", ")}`)],
    [t("projectPage.trust.allow"), [...load.allowRules, ...more(load.omitted.allowRules)]],
    [t("projectPage.trust.agents"), load.agents],
    [t("projectPage.trust.skills"), load.skills],
    [t("projectPage.trust.commands"), load.commands],
    [t("projectPage.trust.claudeMd"), load.claudeMd ? ["CLAUDE.md"] : []],
    [t("projectPage.trust.unreadable"), load.unreadable],
  ];
  const shown = groups.filter(([, items]) => items.length > 0);
  // A command with several lines, or one that does not fit a short line, is shown in a block of
  // its own, whole; a short one stays a line. Either way all of it runs once trusted.
  const isLong = (item: string) => item.includes("\n") || item.length > LONG_LINE;
  const anyLong = shown.some(([, items]) => items.some(isLong));
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
      {anyLong && <p className="text-sm">{t("projectPage.trust.longWarning")}</p>}
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
                      {isLong(item) ? (
                        <pre
                          className="max-h-48 overflow-auto whitespace-pre-wrap break-all"
                          // biome-ignore lint/a11y/noNoninteractiveTabindex: a long command scrolls, and focus lets the keyboard do it
                          tabIndex={0}
                        >
                          {item}
                        </pre>
                      ) : (
                        item
                      )}
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
