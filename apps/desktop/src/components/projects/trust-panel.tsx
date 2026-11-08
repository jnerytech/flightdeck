import type { ProjectLoad, ProjectTrustState } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { HarnessPanel } from "@/components/projects/harness-panel";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** What the panel says about the folder: trusted (on its own or through a parent), or not. */
function trustLine(state: ProjectTrustState, t: AppStore["i18n"]["t"]): string {
  if (!state.trusted) return t("projectPage.trust.untrusted");
  if (state.via && state.via !== state.path) {
    return t("projectPage.trust.trustedVia", { path: state.via });
  }
  return t("projectPage.trust.trusted");
}

/** Past this many characters a listed command is shown in a block of its own. */
const LONG_LINE = 300;

/** `load` is null when only the listing was refused (it is for a near connection): the decision is still shown. */
type Loaded = { state: ProjectTrustState; load: ProjectLoad | null } | "failed" | null;

/**
 * Whether a project's own hooks, MCP servers, settings, agents and skills may load into a session
 * (issue #196): what the project would load, read without running anything, what not trusting costs,
 * and the decision. Trusting asks first; revoking does not. Hidden on a host that does not announce it.
 */
export function TrustPanel(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
    projectName: string;
    path: string;
    /** The host can preview and apply a harness setup (#75): the checklist offers it. */
    canSetUp?: boolean;
    /** The host can also commit what the setup wrote on a new branch (#75, C1). */
    canCommit?: boolean;
    /** The host can draft a CLAUDE.md with its model (#75, G1). */
    canDraft?: boolean;
    /** The host keeps a project's Markdown setup as a template (#75, T2). */
    canShare?: boolean;
  }>,
) {
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
    setLoaded(state ? { state, load: load ?? null } : "failed");
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
  const groups: Array<[string, string[]]> = !load
    ? []
    : [
        [
          t("projectPage.trust.hooks"),
          [
            ...load.hooks.flatMap((h) => h.commands.map((c) => `${h.event}: ${c}`)),
            ...more(load.omitted.hooks),
          ],
        ],
        [
          t("projectPage.trust.mcp"),
          [
            ...load.mcpServers.map((s) => `${s.name}: ${s.command}`),
            ...more(load.omitted.mcpServers),
          ],
        ],
        [t("projectPage.trust.programs"), load.executables.map((e) => `${e.key}: ${e.command}`)],
        [t("projectPage.trust.env"), [...load.envKeys, ...more(load.omitted.envKeys)]],
        [t("projectPage.trust.redirects"), load.redirects.map((r) => `${r.key} = ${r.value}`)],
        [t("projectPage.trust.plugins"), load.plugins],
        [t("projectPage.trust.otherKeys"), load.otherKeys],
        [t("projectPage.trust.extras"), load.extras.map((x) => `${x.file}: ${x.keys.join(", ")}`)],
        [t("projectPage.trust.allow"), [...load.allowRules, ...more(load.omitted.allowRules)]],
        [
          t("projectPage.trust.deny"),
          [...(load.denyRules ?? []), ...more(load.omitted.denyRules ?? 0)],
        ],
        [t("projectPage.trust.agents"), load.agents],
        [t("projectPage.trust.skills"), load.skills],
        [t("projectPage.trust.commands"), load.commands],
        [t("projectPage.trust.claudeMd"), load.claudeMd ? ["CLAUDE.md"] : []],
        [t("projectPage.trust.unreadable"), load.unreadable],
      ];
  const shown = groups.filter(([, items]) => items.length > 0);
  // The line that stands in for the listing when there is none to show.
  let listingNote: "projectPage.trust.listingUnavailable" | "projectPage.trust.nothing" | null =
    null;
  if (!load) listingNote = "projectPage.trust.listingUnavailable";
  else if (shown.length === 0) listingNote = "projectPage.trust.nothing";
  // A command with several lines, or one that does not fit a short line, is shown in a block of
  // its own, whole; a short one stays a line. Either way all of it runs once trusted.
  const isLong = (item: string) => item.includes("\n") || item.length > LONG_LINE;
  const anyLong = shown.some(([, items]) => items.some(isLong));
  return (
    <>
      <Panel title={t("projectPage.trust.title")} label={t("projectPage.trust.title")}>
        <p className="text-muted-foreground text-xs">{t("projectPage.trust.hint")}</p>
        <p className="font-medium text-sm">{trustLine(state, t)}</p>
        {!state.trusted && <p className="text-sm">{t("projectPage.trust.cost")}</p>}
        {state.staleSessions !== undefined && (
          <p className="text-sm">{t("projectPage.trust.staleCount", { n: state.staleSessions })}</p>
        )}
        <h3 className="font-medium text-sm">{t("projectPage.trust.listing")}</h3>
        {anyLong && <p className="text-sm">{t("projectPage.trust.longWarning")}</p>}
        {listingNote ? (
          <p className="text-sm">{t(listingNote)}</p>
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            {shown.map(([title, items]) => (
              <div key={title} className="flex flex-col gap-1">
                <dt className="font-medium">{title}</dt>
                <dd>
                  <ul className="flex flex-col gap-1">
                    {items.map((item) => (
                      <li key={item} className="font-mono text-xs [overflow-wrap:anywhere]">
                        {isLong(item) ? (
                          <pre
                            className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2"
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
            // Trusting is for a person who read what the project would load: no listing, no button.
            load && (
              <ActionButton variant="outline" onClick={() => setAsking(true)}>
                {t("projectPage.trust.action")}
              </ActionButton>
            )
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
      {load && (
        <HarnessPanel
          load={load}
          t={t}
          setup={
            props.canSetUp
              ? {
                  store,
                  hostId,
                  path,
                  trusted: state.trusted,
                  onApplied: read,
                  canCommit: props.canCommit === true,
                  canDraft: props.canDraft === true,
                  canTemplates: props.canShare === true,
                }
              : null
          }
          share={props.canShare ? { store, hostId, path } : null}
        />
      )}
    </>
  );
}
