import type { HooksStatusResult } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HarnessTemplatesSection } from "@/features/harness/ui.ts";
import type { ProjectCard } from "@/features/projects/index.ts";
import type { HubRow } from "@/features/sessions/index.ts";
import { useT } from "@/i18n/context";
import { useHostLatency, useStoreSlice } from "@/lib/use-store";
import { ActionButton, ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { FieldRow, Page, Panel, Stack } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { APP_VERSION, hasFeature } from "../../lib/version.ts";
import type { UsageHistoryTarget } from "../costs/index.ts";
import { UsagePanel } from "../costs/usage-panel.tsx";
import { MaintenanceSection } from "../maintenance/ui.ts";
import { TelemetrySection } from "../telemetry/ui.ts";
import { AllowedFolders } from "./allowed-folders.tsx";
import { BypassSwitch } from "./bypass-switch.tsx";
import { DaemonUpdate } from "./daemon-update.tsx";
import { hostDownReason } from "./domain/host-down-reason.ts";
import type { HostNameError } from "./domain/host-name.ts";
import { hostUptime } from "./domain/host-offline.ts";
import { GithubPanel } from "./github-panel.tsx";
import { HostAccount } from "./host-account.tsx";
import { HostAutoUpdate } from "./host-auto-update.tsx";
import { HostCompare } from "./host-compare.tsx";
import { HostHealth } from "./host-health.tsx";
import { HostLogs } from "./host-logs.tsx";
import { HostOfflineBanner } from "./host-offline-banner.tsx";
import { HostOverview } from "./host-overview.tsx";
import { HostPausePanel } from "./host-pause-panel.tsx";
import { HostResources } from "./host-resources.tsx";
import { HostTerminal } from "./host-terminal.tsx";
import { HostVersionLine } from "./host-version.tsx";
import { HostWorktrees } from "./host-worktrees.tsx";
import { KeepAwakePanel } from "./keep-awake-panel.tsx";
import { RenameHostDialog } from "./rename-host-dialog.tsx";
import { ResumePanel } from "./resume-panel.tsx";
import { SimpleModePanel } from "./simple-mode-panel.tsx";
import { SleepSetting } from "./sleep-setting.tsx";
import { useNow } from "./use-now.ts";

/** What the overview reads from the app: the sessions, the projects and the cards of the hosts. */
const OVERVIEW_KEYS = [
  "hosts",
  "hub",
  "meta",
  "externals",
  "names",
  "background",
  "projects",
  "cards",
  "deps",
  "doctor",
  "healthAt",
  "healthError",
] as const;

/**
 * The tabs' panels stay mounted (what each one loads, and what was typed in it, is kept when the
 * person goes to another tab): only the open one shows.
 */
const PANEL = "data-[state=inactive]:hidden";
/** A tab of forms and tables keeps a reading width; the Overview takes the whole area (#785). */
const NARROW_PANEL = `${PANEL} max-w-3xl`;

/** The tab a section ask opens (#1484, #2588): Health is on the Overview, the others on Settings. */
const tabOf = (section: "pause" | "keep-awake" | "health") =>
  section === "health" ? "overview" : "settings";
/** The panel whose heading takes the focus. */
const slotOf = (section: "pause" | "keep-awake" | "health") =>
  `[data-slot="${section === "health" ? "host-health" : `host-section-${section}`}"]`;

const HOOK_LABELS = {
  installed: "hostPage.hooksInstalled",
  absent: "hostPage.hooksAbsent",
  outdated: "hostPage.hooksOutdated",
} as const satisfies Record<HooksStatusResult["status"], Key>;

/**
 * One host: what `host.info` reports, heartbeat latency, the Claude Code hooks, and rename /
 * reconnect / remove.
 */
export function HostPage(
  props: Readonly<{
    store: AppStore;
    host: HostView;
    onRename(name: string): HostNameError | null;
    onReconnect(): void;
    onPairAgain?(input: string): Promise<string | null>;
    onOpenAutoApprovals(): void;
    onOpenHistory(filter: UsageHistoryTarget): void;
    onOpenSession(row: HubRow): void;
    onOpenProject(card: ProjectCard): void;
    onSeeAllSessions(): void;
    onSeeAllProjects(): void;
    onNewSession(): void;
    onRemove(): void;
    /** Issue #1484: open Settings at this panel, with the focus on its heading. */
    section?: "pause" | "keep-awake" | "health";
    /** The section was shown, or another tab was picked first: the ask is used up. */
    onSectionDone?(): void;
  }>,
) {
  const t = useT();
  const { host } = props;
  const [renaming, setRenaming] = useState(false);
  const info = host.hostInfo;
  const { store } = props;
  const [hooks, setHooks] = useState<HooksStatusResult | null>(null);
  const [confirming, setConfirming] = useState<"install" | "uninstall" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState(props.section ? tabOf(props.section) : "overview");
  const now = useNow();
  const overviewState = useStoreSlice(store, OVERVIEW_KEYS);
  // Opening the page reads the health again when the last read is older than a few minutes.
  useEffect(() => {
    if (host.status === "online") void store.health.ensure(host.id);
  }, [store, host.id, host.status]);
  const offline = host.status !== "online" && host.status !== "incompatible";
  const hooksKey = hooks ? HOOK_LABELS[hooks.status] : "hostPage.hooksAsking";
  useEffect(() => {
    if (host.status !== "online") return;
    void store.hostCommand(host.id, "hooks.status", {}).then(setHooks);
  }, [store, host.id, host.status]);
  // The Health section can install the hooks too: the status shown in Settings is read again.
  const refreshHooks = () => void store.hostCommand(host.id, "hooks.status", {}).then(setHooks);
  // "Add folder" in the Health section opens Settings: once that panel shows, the field takes focus.
  const [folderAsk, setFolderAsk] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new ask moves the focus
  useEffect(() => {
    if (folderAsk === 0 || tab !== "settings") return;
    const field = document.querySelector<HTMLElement>("[data-folder-field]");
    field?.focus();
    field?.scrollIntoView?.({ block: "center" });
  }, [folderAsk]);
  // A status-bar item opens its section (#1484): Settings, the panel in view, the focus on its heading.
  // The panel shows once the host says it has the feature, so the move waits for it.
  const section = props.section;
  const sectionShown =
    (section === "pause" && info?.pause !== undefined) ||
    (section === "keep-awake" && info?.keepAwake !== undefined) ||
    (section === "health" &&
      (hasFeature(info?.features, "depsCheck", false) ||
        hasFeature(info?.features, "doctor.run", false)));
  // The focus moves once the Settings panel is active (a browser does not focus into a hidden
  // one), then the ask is used up, so it never pulls the person back later.
  // It looks only inside this page (another page may show the same section), and moves the focus
  // once per ask, even when the route keeps the ask.
  const onSectionDone = props.onSectionDone;
  const tabsRef = useRef<HTMLDivElement>(null);
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (section) setTab(tabOf(section));
    else handled.current = undefined;
  }, [section]);
  useEffect(() => {
    if (!section || handled.current === section || tab !== tabOf(section) || !sectionShown) return;
    const heading = tabsRef.current?.querySelector<HTMLElement>(`${slotOf(section)} h3`);
    if (!heading) return;
    handled.current = section;
    heading.tabIndex = -1;
    heading.scrollIntoView?.({ block: "center" });
    heading.focus();
    onSectionDone?.();
  }, [section, tab, sectionShown, onSectionDone]);
  // Another tab picked before the section showed drops the ask too.
  const pickTab = (value: string) => {
    setTab(value);
    if (!section) return;
    handled.current = section;
    onSectionDone?.();
  };
  // A daemon older than the app may not have looked for its update since the release: ask it once
  // (the store keeps this to once per 10 minutes per host).
  const checkable = host.status === "online" && info?.update !== undefined;
  const daemonVersion = info?.daemonVersion;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the daemon's version is what makes it worth asking again
  useEffect(() => {
    if (checkable) void store.hostUpdate.autoCheck(host.id);
  }, [store, host.id, checkable, daemonVersion]);
  const settingsPath = hooks?.settingsPath ?? "~/.claude/settings.json";
  // Hooks came with the central (phase 5): shown for older daemons, hidden when not announced.
  const showHooks = host.status !== "incompatible" && hasFeature(info?.features, "central", true);
  const apply = async () => {
    const kind = confirming;
    setConfirming(null);
    const result =
      kind === "install"
        ? await store.hostCommand(host.id, "hooks.install", { confirm: true })
        : await store.hostCommand(host.id, "hooks.uninstall", { confirm: true });
    if (result) setHooks(result);
    // The setup checklist reads the hooks too.
    void store.refreshSetup(host.id);
  };
  return (
    <Page
      title={host.name}
      subtitle={
        <HostVersionLine
          url={host.url}
          daemon={info?.daemonVersion ?? null}
          app={APP_VERSION}
          t={t}
        />
      }
      actions={
        <Button variant="outline" onClick={() => setRenaming(true)}>
          {t("hostPage.rename")}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {offline && (
          <HostOfflineBanner
            host={host}
            onReconnect={props.onReconnect}
            {...(props.onPairAgain ? { onPairAgain: props.onPairAgain } : {})}
          />
        )}
        {host.status === "incompatible" && (
          <InlineNotice>
            <span className="flex flex-col gap-1">
              {/* Issue #181: one sentence of the catalog; the daemon's own words stay under Details. */}
              <span>{t("errors.protocol_incompatible")}</span>
              {host.incompatibility && (
                <details>
                  <summary>{t("toast.details")}</summary>
                  {host.incompatibility}
                </details>
              )}
              <span>
                {t("hostPage.incompatibleFix", { version: APP_VERSION })}{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs">
                  flightdeckd update --from {t("daemonUpdate.binary")}
                </code>
              </span>
            </span>
          </InlineNotice>
        )}
        {info?.apiKeySanitized === false && (
          <InlineNotice>{t("hostPage.apiKeyForwarded")}</InlineNotice>
        )}
        <Tabs ref={tabsRef} value={tab} onValueChange={pickTab}>
          <TabsList aria-label={t("hostHome.tabs")}>
            <TabsTrigger value="overview">{t("hostHome.overview")}</TabsTrigger>
            <TabsTrigger value="usage">{t("hostHome.usage")}</TabsTrigger>
            <TabsTrigger value="settings">{t("hostHome.settings")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" forceMount className={PANEL}>
            {/* #785: the host's status first (health, resources, information), its work beside it
                once the area is 64rem wide; one column, status first, when narrower. */}
            <Stack gap={4}>
              <div className="host-overview">
                <div data-slot="host-overview-status" className="host-overview-column">
                  {(hasFeature(info?.features, "depsCheck", false) ||
                    hasFeature(info?.features, "doctor.run", false)) && (
                    <HostHealth
                      store={store}
                      host={host}
                      deps={overviewState.deps[host.id] ?? null}
                      doctor={overviewState.doctor[host.id] ?? null}
                      checkedAt={overviewState.healthAt[host.id] ?? null}
                      error={overviewState.healthError[host.id] ?? null}
                      onCheck={() => store.health.check(host.id)}
                      onAddFolder={() => {
                        setTab("settings");
                        setFolderAsk((n) => n + 1);
                      }}
                      onHooksChanged={refreshHooks}
                    />
                  )}
                  <HostResources store={store} host={host} />
                  <Panel title={t("hostPage.info")} label={t("hostPage.info")}>
                    {info ? (
                      <ul className="flex flex-col gap-1 text-sm">
                        <li>{`${info.os} · ${info.arch}`}</li>
                        <li>{t("hostPage.daemon", { version: info.daemonVersion })}</li>
                        <li>{t("hostPage.app", { version: APP_VERSION })}</li>
                        {info.daemonVersion !== APP_VERSION && (
                          <li className="text-status-needs-you">{t("hostPage.differs")}</li>
                        )}
                        <li>
                          {t("hostPage.claude", {
                            version: info.claudeVersion ?? t("hostPage.unknown"),
                          })}
                        </li>
                        <li>{t("hostPage.active", { n: info.activeSessions })}</li>
                        <li>
                          {t("hostPage.uptime", {
                            n: hostUptime(info.uptimeSec, host.infoAt, now),
                          })}
                        </li>
                        <HostLatency store={store} hostId={host.id} />
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {offline ? t("hostOffline.title") : t("hostPage.unavailable")}
                      </p>
                    )}
                  </Panel>
                </div>
                <div data-slot="host-overview-work" className="host-overview-column">
                  <HostOverview
                    store={store}
                    state={overviewState}
                    host={host}
                    onOpenSession={props.onOpenSession}
                    onOpenProject={props.onOpenProject}
                    onSeeAllSessions={props.onSeeAllSessions}
                    onSeeAllProjects={props.onSeeAllProjects}
                    onNewSession={props.onNewSession}
                  />
                  {hasFeature(info?.features, "account", false) && (
                    <HostAccount store={store} host={host} />
                  )}
                </div>
              </div>
              {/* #1516: a band of its own, as wide as the Overview: a column is half of it. */}
              <HostCompare store={store} hostId={host.id} />
            </Stack>
          </TabsContent>
          <TabsContent value="usage" forceMount className={NARROW_PANEL}>
            <Stack gap={4}>
              {(hasFeature(info?.features, "quota", false) ||
                hasFeature(info?.features, "costs", false)) && (
                <UsagePanel
                  store={store}
                  hostId={host.id}
                  online={host.status === "online"}
                  costs={hasFeature(info?.features, "costs", false)}
                  onOpenHistory={props.onOpenHistory}
                />
              )}
            </Stack>
          </TabsContent>
          <TabsContent value="settings" forceMount className={NARROW_PANEL}>
            <Stack gap={4}>
              <AllowedFolders store={store} host={host} />
              <BypassSwitch store={store} host={host} />
              <SleepSetting store={store} host={host} />
              <SimpleModePanel store={store} host={host} />
              <KeepAwakePanel store={store} host={host} />
              <HostPausePanel store={store} host={host} />
              <ResumePanel store={store} host={host} />
              {host.status === "online" && hasFeature(info?.features, "github", false) && (
                <GithubPanel store={store} host={host} />
              )}
              <HostWorktrees store={store} host={host} />
              <HostAutoUpdate store={store} host={host} />
              <DaemonUpdate store={store} host={host} />
              {showHooks && (
                <section aria-label={t("hostPage.hooks")}>
                  <Panel title={t("hostPage.hooks")}>
                    <p className="text-sm">{offline ? t("hostOffline.title") : t(hooksKey)}</p>
                    {/* Issue #181: nothing to install on a host that does not answer; the row says why. */}
                    <FieldRow>
                      <ActionButton
                        variant="outline"
                        size="sm"
                        disabled={offline}
                        disabledReason={hostDownReason(host.status, host.name, t)}
                        onClick={() => setConfirming("install")}
                      >
                        {t("hostPage.install")}
                      </ActionButton>
                      <ActionButton
                        variant="outline"
                        size="sm"
                        disabled={offline}
                        disabledReason={hostDownReason(host.status, host.name, t)}
                        onClick={() => setConfirming("uninstall")}
                      >
                        {t("hostPage.uninstall")}
                      </ActionButton>
                    </FieldRow>
                  </Panel>
                </section>
              )}
              {host.status === "online" && hasFeature(info?.features, "telemetry", false) && (
                <TelemetrySection store={store} hostId={host.id} />
              )}
              {host.status === "online" && hasFeature(info?.features, "autoapprove", false) && (
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={props.onOpenAutoApprovals}
                >
                  {t("autoApprovalsUi.open")}
                </Button>
              )}
              <HostTerminal store={store} host={host} />
              {host.status === "online" && hasFeature(info?.features, "maintenance", false) && (
                <MaintenanceSection store={store} hostId={host.id} />
              )}
              {host.status === "online" &&
                hasFeature(info?.features, "harnessTemplates", false) && (
                  <HarnessTemplatesSection store={store} hostId={host.id} />
                )}
              <HostLogs store={store} host={host} />
              <Panel title={t("hostPage.host")}>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={props.onReconnect}>
                    {t("hostPage.reconnect")}
                  </Button>
                  <Button variant="destructive" onClick={() => setRemoving(true)}>
                    {t("hostPage.remove")}
                  </Button>
                </div>
                {removing && (
                  <ConfirmDialog
                    message={t("sidebar.removeConfirm", { host: host.name })}
                    confirmLabel={t("hostPage.remove")}
                    destructive
                    onConfirm={() => {
                      setRemoving(false);
                      props.onRemove();
                    }}
                    onCancel={() => setRemoving(false)}
                  />
                )}
              </Panel>
            </Stack>
          </TabsContent>
        </Tabs>
        {confirming && (
          <ConfirmDialog
            message={
              confirming === "install"
                ? t("hostPage.installMessage", { path: settingsPath })
                : t("hostPage.uninstallMessage", { path: settingsPath })
            }
            confirmLabel={
              confirming === "install" ? t("hostPage.install") : t("hostPage.uninstall")
            }
            destructive={confirming === "uninstall"}
            onConfirm={() => void apply()}
            onCancel={() => setConfirming(null)}
          />
        )}
        {renaming && (
          <RenameHostDialog
            name={host.name}
            onRename={props.onRename}
            onClose={() => setRenaming(false)}
          />
        )}
      </div>
    </Page>
  );
}

/** The heartbeat latency line: the only part of the page that renders on a ping. */
function HostLatency(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const latency = useHostLatency(props.store, props.hostId);
  return <li>{t("hostPage.latency", { value: latency === null ? "—" : `${latency} ms` })}</li>;
}
