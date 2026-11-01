import type { InstalledPlugin, PluginList } from "@flightdeck/protocol";
import { memo, useCallback, useEffect, useState } from "react";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Field, Form } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Inline, Stack } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { InstallDialog, type InstallSource } from "@/components/plugins/install-dialog";
import { InventoryView } from "@/components/plugins/inventory-view";
import { UpdateDialog } from "@/components/plugins/update-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FolderPicker } from "./FolderPicker.tsx";

const PLUGINSPAGE_KEYS = ["hosts"] as const;

/**
 * Phase 26: the Claude Code plugins of the first online host that keeps them. A plugin runs code
 * on the machine, so each one shows what it installs, and the hooks that can decide for the user
 * carry a mark.
 */
export const PluginsPage = memo(function PluginsPage(props: { store: AppStore }) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, PLUGINSPAGE_KEYS);
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "plugins", false),
  );
  const hostId = host?.id;
  const [list, setList] = useState<PluginList | null>(null);
  const [looking, setLooking] = useState<InstalledPlugin | null>(null);
  const [installing, setInstalling] = useState<InstallSource | null>(null);
  const [folder, setFolder] = useState("");
  const [browsing, setBrowsing] = useState(false);
  /** The host answers `fs.dirs`: an older daemon does not, and there the folder is only typed. */
  const canBrowse = hasFeature(host?.hostInfo?.features, "fs.dirs", false);
  const [updating, setUpdating] = useState<InstalledPlugin | null>(null);
  const [asking, setAsking] = useState<
    | { kind: "remove"; plugin: InstalledPlugin }
    | { kind: "add" }
    | { kind: "drop"; name: string }
    | null
  >(null);
  const [source, setSource] = useState("");

  /** A change that went through: the message of the CLI, and the lists again. */
  const done = async (message: string | null, ok: boolean) => {
    if (ok && message) store.success(message);
    await reload();
  };
  const pin = async (plugin: InstalledPlugin) => {
    if (!hostId) return;
    await store.hostCommand(hostId, "plugins.pin", { plugin: plugin.id, pinned: !plugin.pinned });
    await reload();
  };
  const confirmed = async () => {
    const asked = asking;
    setAsking(null);
    if (!asked || !hostId) return;
    if (asked.kind === "remove") {
      const scope = ["user", "project", "local"].includes(asked.plugin.scope)
        ? (asked.plugin.scope as "user" | "project" | "local")
        : undefined;
      const result = await store.hostCommand(hostId, "plugins.uninstall", {
        plugin: asked.plugin.id,
        ...(scope ? { scope } : {}),
        confirm: true,
      });
      await done(t("pluginsUi.removed"), result?.outcome === "ok");
    } else if (asked.kind === "add") {
      const result = await store.hostCommand(hostId, "plugins.marketplaceAdd", {
        source: source.trim(),
        confirm: true,
      });
      setSource("");
      await done(t("pluginsUi.marketplaceAdded"), result?.outcome === "ok");
    } else {
      const result = await store.hostCommand(hostId, "plugins.marketplaceRemove", {
        name: asked.name,
        confirm: true,
      });
      await done(t("pluginsUi.marketplaceRemoved"), result?.outcome === "ok");
    }
  };
  const refreshMarketplace = async (name: string) => {
    if (!hostId) return;
    const result = await store.hostCommand(hostId, "plugins.marketplaceUpdate", { name });
    await done(t("pluginsUi.marketplaceUpdated"), result?.outcome === "ok");
  };

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
            <Stack gap={3}>
              <Form
                variant="inline"
                onSubmit={() => folder.trim() !== "" && setInstalling({ dir: folder.trim() })}
              >
                <Field
                  label={t("pluginsUi.folder")}
                  help={canBrowse ? t("pluginsUi.folderHint") : undefined}
                >
                  {(control) => (
                    <Inline gap={2}>
                      <Input
                        {...control}
                        className="flex-1"
                        value={folder}
                        onChange={(e) => setFolder(e.target.value)}
                      />
                      {canBrowse && (
                        <Button type="button" variant="outline" onClick={() => setBrowsing(true)}>
                          {t("folderPicker.browse")}
                        </Button>
                      )}
                      <Button type="submit" variant="outline" disabled={folder.trim() === ""}>
                        {t("pluginsUi.folderPreview")}
                      </Button>
                    </Inline>
                  )}
                </Field>
              </Form>
              {list.installed.length === 0 && <EmptyState title={t("pluginsUi.noneInstalled")} />}
              <Stack as="ul" gap={2} label={t("pluginsUi.installedList")}>
                {list.installed.map((plugin) => (
                  <Panel as="li" size="sm" key={`${plugin.id}/${plugin.scope}`}>
                    <Inline gap={2} className="justify-between">
                      <Inline gap={2}>
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
                        {plugin.pinned && (
                          <Badge variant="outline">
                            {t("pluginsUi.pinned", { version: plugin.pinned.version })}
                          </Badge>
                        )}
                      </Inline>
                      <Inline gap={2}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={plugin.pinned !== null}
                          aria-label={t("pluginsUi.update", { name: plugin.name })}
                          onClick={() => setUpdating(plugin)}
                        >
                          {t("pluginsUi.updateShort")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={
                            plugin.pinned
                              ? t("pluginsUi.unpin", { name: plugin.name })
                              : t("pluginsUi.pin", { name: plugin.name })
                          }
                          onClick={() => void pin(plugin)}
                        >
                          {plugin.pinned ? t("pluginsUi.unpinShort") : t("pluginsUi.pinShort")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("pluginsUi.remove", { name: plugin.name })}
                          onClick={() => setAsking({ kind: "remove", plugin })}
                        >
                          {t("pluginsUi.removeShort")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("pluginsUi.see", { name: plugin.name })}
                          onClick={() => setLooking(plugin)}
                        >
                          {t("pluginsUi.seeShort")}
                        </Button>
                      </Inline>
                    </Inline>
                    {plugin.errors.map((error) => (
                      <p key={error} className="text-status-needs-you text-sm">
                        {error}
                      </p>
                    ))}
                  </Panel>
                ))}
              </Stack>
            </Stack>
          </TabsContent>
          <TabsContent value="available">
            <Stack gap={3}>
              {list.available.length === 0 && <EmptyState title={t("pluginsUi.noneAvailable")} />}
              <Stack as="ul" gap={2} label={t("pluginsUi.availableList")}>
                {list.available.map((plugin) => (
                  <Panel as="li" size="sm" key={plugin.id}>
                    <Inline gap={2}>
                      <span data-name className="font-medium">
                        {plugin.name}
                      </span>
                      {plugin.version && <Badge variant="secondary">{plugin.version}</Badge>}
                      <Badge variant="outline">{plugin.marketplace}</Badge>
                    </Inline>
                    {plugin.description && (
                      <p className="text-muted-foreground text-sm">{plugin.description}</p>
                    )}
                    <Inline>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("pluginsUi.install", { name: plugin.name })}
                        onClick={() => setInstalling({ plugin: plugin.id })}
                      >
                        {t("pluginsUi.installShort")}
                      </Button>
                    </Inline>
                  </Panel>
                ))}
              </Stack>
            </Stack>
          </TabsContent>
          <TabsContent value="marketplaces">
            <Stack gap={3}>
              <Form
                variant="inline"
                onSubmit={() => source.trim() !== "" && setAsking({ kind: "add" })}
              >
                <Field label={t("pluginsUi.source")}>
                  {(control) => (
                    <Inline gap={2}>
                      <Input
                        {...control}
                        className="flex-1"
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      />
                      <Button type="submit" variant="outline" disabled={source.trim() === ""}>
                        {t("pluginsUi.addMarketplace")}
                      </Button>
                    </Inline>
                  )}
                </Field>
              </Form>
              {list.marketplaces.length === 0 && (
                <EmptyState title={t("pluginsUi.noneMarketplaces")} />
              )}
              <Stack as="ul" gap={2} label={t("pluginsUi.marketplacesList")}>
                {list.marketplaces.map((market) => (
                  <Panel as="li" size="sm" key={market.name}>
                    <Inline gap={2} className="justify-between">
                      <Inline gap={2}>
                        <span data-name className="font-medium">
                          {market.name}
                        </span>
                        <Badge variant="outline">{market.source}</Badge>
                        {market.origin && (
                          <span className="break-all text-muted-foreground text-sm">
                            {market.origin}
                          </span>
                        )}
                      </Inline>
                      <Inline gap={2}>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("pluginsUi.refreshMarketplace", { name: market.name })}
                          onClick={() => void refreshMarketplace(market.name)}
                        >
                          {t("pluginsUi.refreshShort")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("pluginsUi.dropMarketplace", { name: market.name })}
                          onClick={() => setAsking({ kind: "drop", name: market.name })}
                        >
                          {t("pluginsUi.removeShort")}
                        </Button>
                      </Inline>
                    </Inline>
                  </Panel>
                ))}
              </Stack>
            </Stack>
          </TabsContent>
        </Tabs>
      )}
      {browsing && host && canBrowse && (
        <FolderPicker
          store={store}
          host={host}
          onPick={(path) => {
            setBrowsing(false);
            setFolder(path);
          }}
          onClose={() => setBrowsing(false)}
        />
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
      {updating && hostId && (
        <UpdateDialog
          store={store}
          hostId={hostId}
          plugin={updating}
          onClose={() => setUpdating(null)}
          onDone={() => {
            setUpdating(null);
            void reload();
          }}
        />
      )}
      {asking && (
        <ConfirmDialog
          message={
            asking.kind === "remove"
              ? t("pluginsUi.removeMessage", { name: asking.plugin.name })
              : asking.kind === "add"
                ? t("pluginsUi.addMessage", { source })
                : t("pluginsUi.dropMessage", { name: asking.name })
          }
          confirmLabel={
            asking.kind === "remove"
              ? t("pluginsUi.removeConfirm")
              : asking.kind === "add"
                ? t("pluginsUi.addConfirm")
                : t("pluginsUi.dropConfirm")
          }
          destructive={asking.kind !== "add"}
          onConfirm={() => void confirmed()}
          onCancel={() => setAsking(null)}
        />
      )}
      {looking && (
        <Dialog open onOpenChange={(open) => !open && setLooking(null)}>
          <AppDialogContent>
            <DialogHeader>
              <DialogTitle>{t("pluginsUi.whatInstalls", { name: looking.name })}</DialogTitle>
              <DialogDescription>{t("pluginsUi.whatInstallsHint")}</DialogDescription>
            </DialogHeader>
            {looking.inventory ? (
              <InventoryView inventory={looking.inventory} />
            ) : (
              <p className="text-sm">{t("pluginsUi.noInventory")}</p>
            )}
          </AppDialogContent>
        </Dialog>
      )}
    </Page>
  );
});
