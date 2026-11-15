import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectCard } from "@/features/projects/index.ts";
import type { HubRow } from "@/features/sessions/index.ts";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Page, Stack } from "@/shared/layout/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import type { HostSection } from "../../lib/router.ts";
import { APP_VERSION, hasFeature } from "../../lib/version.ts";
import type { UsageHistoryTarget } from "../costs/index.ts";
import { UsagePanel } from "../costs/ui.ts";
import type { HostNameError } from "./domain/host-name.ts";
import { HostAccount } from "./host-account.tsx";
import { HostCompare } from "./host-compare.tsx";
import { HostHealth } from "./host-health.tsx";
import { useHostHooks } from "./host-hooks.tsx";
import { HostIncompatibleNotice, HostInfoPanel } from "./host-info-panel.tsx";
import { HostOfflineBanner } from "./host-offline-banner.tsx";
import { HostOverview } from "./host-overview.tsx";
import { HostResources } from "./host-resources.tsx";
import { HostSettingsPanel } from "./host-settings-panel.tsx";
import { HostVersionLine } from "./host-version.tsx";
import { RenameHostDialog } from "./rename-host-dialog.tsx";
import { useHostTab } from "./use-host-tab.ts";

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
    section?: HostSection;
    /** The section was shown, or another tab was picked first: the ask is used up. */
    onSectionDone?(): void;
  }>,
) {
  const t = useT();
  const { host } = props;
  const [renaming, setRenaming] = useState(false);
  const info = host.hostInfo;
  const { store } = props;
  const hostHooks = useHostHooks(store, host);
  const { tab, tabsRef, pickTab, askFolder } = useHostTab(info, props.section, props.onSectionDone);
  const overviewState = useStoreSlice(store, OVERVIEW_KEYS);
  // Opening the page reads the health again when the last read is older than a few minutes.
  useEffect(() => {
    if (host.status === "online") void store.health.ensure(host.id);
  }, [store, host.id, host.status]);
  const offline = host.status !== "online" && host.status !== "incompatible";
  // A daemon older than the app may not have looked for its update since the release: ask it once
  // (the store keeps this to once per 10 minutes per host).
  const checkable = host.status === "online" && info?.update !== undefined;
  const daemonVersion = info?.daemonVersion;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the daemon's version is what makes it worth asking again
  useEffect(() => {
    if (checkable) void store.hostUpdate.autoCheck(host.id);
  }, [store, host.id, checkable, daemonVersion]);
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
        {host.status === "incompatible" && <HostIncompatibleNotice host={host} />}
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
                      onAddFolder={askFolder}
                      onHooksChanged={hostHooks.refresh}
                    />
                  )}
                  <HostResources store={store} host={host} />
                  <HostInfoPanel store={store} host={host} offline={offline} />
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
            <HostSettingsPanel
              store={store}
              host={host}
              hooksSection={hostHooks.section}
              onReconnect={props.onReconnect}
              onRemove={props.onRemove}
              onOpenAutoApprovals={props.onOpenAutoApprovals}
            />
          </TabsContent>
        </Tabs>
        {hostHooks.dialog}
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
