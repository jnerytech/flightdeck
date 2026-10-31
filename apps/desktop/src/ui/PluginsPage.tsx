import type { InstalledPlugin, PluginList } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { InstallDialog, type InstallSource } from "@/components/plugins/install-dialog";
import { InventoryView } from "@/components/plugins/inventory-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";

/**
 * Phase 26: the Claude Code plugins of the first online host that keeps them. A plugin runs code
 * on the machine, so each one shows what it installs, and the hooks that can decide for the user
 * carry a mark.
 */
export function PluginsPage(props: { store: AppStore; state: AppState }) {
  const t = useT();
  const { store, state } = props;
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "plugins", false),
  );
  const hostId = host?.id;
  const [list, setList] = useState<PluginList | null>(null);
  const [looking, setLooking] = useState<InstalledPlugin | null>(null);
  const [installing, setInstalling] = useState<InstallSource | null>(null);
  const [folder, setFolder] = useState("");

  const reload = useCallback(async () => {
    if (!hostId) return;
    const result = await store.hostCommand(hostId, "plugins.list", {});
    setList(result ?? { installed: [], available: [], marketplaces: [] });
  }, [store, hostId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Page
      title={t("pluginsUi.title")}
      subtitle={t("pluginsUi.subtitle", { host: host?.name ?? "" })}
    >
      {list === null ? (
        <LoadingState label={t("agent.loading")} />
      ) : (
        <Tabs defaultValue="installed">
          <TabsList aria-label={t("pluginsUi.tabs")}>
            <TabsTrigger value="installed">{t("pluginsUi.tabInstalled")}</TabsTrigger>
            <TabsTrigger value="available">{t("pluginsUi.tabAvailable")}</TabsTrigger>
            <TabsTrigger value="marketplaces">{t("pluginsUi.tabMarketplaces")}</TabsTrigger>
          </TabsList>
          <TabsContent value="installed">
            <div className="mb-3 flex flex-col gap-1 text-sm">
              <label htmlFor="plugins-folder">{t("pluginsUi.folder")}</label>
              <div className="flex gap-2">
                <Input
                  id="plugins-folder"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={folder.trim() === ""}
                  onClick={() => setInstalling({ dir: folder.trim() })}
                >
                  {t("pluginsUi.folderPreview")}
                </Button>
              </div>
            </div>
            {list.installed.length === 0 && <EmptyState title={t("pluginsUi.noneInstalled")} />}
            <ul aria-label={t("pluginsUi.installedList")} className="flex flex-col gap-2">
              {list.installed.map((plugin) => (
                <li
                  key={`${plugin.id}/${plugin.scope}`}
                  className="flex flex-col gap-2 rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span data-name className="font-medium">
                      {plugin.name}
                    </span>
                    <Badge variant="secondary">{plugin.version}</Badge>
                    <Badge variant="outline">{plugin.scope}</Badge>
                    <Badge variant="outline">
                      {plugin.enabled ? t("pluginsUi.enabled") : t("pluginsUi.disabled")}
                    </Badge>
                    {plugin.inventory?.attention && (
                      <Badge variant="destructive">{t("pluginsUi.attention")}</Badge>
                    )}
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("pluginsUi.see", { name: plugin.name })}
                      onClick={() => setLooking(plugin)}
                    >
                      {t("pluginsUi.seeShort")}
                    </Button>
                  </div>
                  {plugin.errors.map((error) => (
                    <p key={error} className="text-status-needs-you text-sm">
                      {error}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="available">
            {list.available.length === 0 && <EmptyState title={t("pluginsUi.noneAvailable")} />}
            <ul aria-label={t("pluginsUi.availableList")} className="flex flex-col gap-2">
              {list.available.map((plugin) => (
                <li key={plugin.id} className="flex flex-col gap-1 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span data-name className="font-medium">
                      {plugin.name}
                    </span>
                    {plugin.version && <Badge variant="secondary">{plugin.version}</Badge>}
                    <Badge variant="outline">{plugin.marketplace}</Badge>
                  </div>
                  {plugin.description && (
                    <p className="text-muted-foreground text-sm">{plugin.description}</p>
                  )}
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("pluginsUi.install", { name: plugin.name })}
                      onClick={() => setInstalling({ plugin: plugin.id })}
                    >
                      {t("pluginsUi.installShort")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="marketplaces">
            {list.marketplaces.length === 0 && (
              <EmptyState title={t("pluginsUi.noneMarketplaces")} />
            )}
            <ul aria-label={t("pluginsUi.marketplacesList")} className="flex flex-col gap-2">
              {list.marketplaces.map((market) => (
                <li
                  key={market.name}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                >
                  <span data-name className="font-medium">
                    {market.name}
                  </span>
                  <Badge variant="outline">{market.source}</Badge>
                  {market.origin && (
                    <span className="break-all text-muted-foreground text-sm">{market.origin}</span>
                  )}
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      )}
      {installing && hostId && (
        <InstallDialog
          store={store}
          hostId={hostId}
          source={installing}
          onClose={() => setInstalling(null)}
          onDone={() => {
            setInstalling(null);
            void reload();
          }}
        />
      )}
      {looking && (
        <Dialog open onOpenChange={(open) => !open && setLooking(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("pluginsUi.whatInstalls", { name: looking.name })}</DialogTitle>
              <DialogDescription>{t("pluginsUi.whatInstallsHint")}</DialogDescription>
            </DialogHeader>
            {looking.inventory ? (
              <InventoryView inventory={looking.inventory} />
            ) : (
              <p className="text-sm">{t("pluginsUi.noInventory")}</p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}
