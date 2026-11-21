import type { InstalledPlugin, PluginList } from "@flightdeck/protocol";
import { memo, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { AppDialogContent, ConfirmDialog } from "@/shared/feedback/index.ts";
import {
  EmptyState,
  ErrorState,
  Field,
  Form,
  Inline,
  LoadingState,
  Page,
  Panel,
  Stack,
} from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { FolderPicker } from "../hosts/ui.ts";
import { InstallDialog, type InstallSource } from "./install-dialog.tsx";
import { InventoryView } from "./inventory-view.tsx";
import { isScope, scopeHint, scopeName } from "./scope.ts";
import { UpdateDialog } from "./update-dialog.tsx";

const PLUGINSPAGE_KEYS = ["hosts"] as const;

type Asking =
  | { kind: "remove"; plugin: InstalledPlugin }
  | { kind: "add" }
  | { kind: "drop"; name: string };

/** What the confirmation says for removing a plugin, adding a source or dropping a marketplace. */
function askingWords(asking: Asking, source: string, t: ReturnType<typeof useT>) {
  if (asking.kind === "remove") {
    return {
      message: t("pluginsUi.removeMessage", { name: asking.plugin.name }),
      confirm: t("pluginsUi.removeConfirm"),
    };
  }
  if (asking.kind === "add") {
    return { message: t("pluginsUi.addMessage", { source }), confirm: t("pluginsUi.addConfirm") };
  }
  return {
    message: t("pluginsUi.dropMessage", { name: asking.name }),
    confirm: t("pluginsUi.dropConfirm"),
  };
}

/**
 * Phase 26: the Claude Code plugins of the first online host that keeps them. A plugin runs code
 * on the machine, so each one shows what it installs, and the hooks that can decide for the user
 * carry a mark.
 */
/** The scope of an installed plugin: its name in the app's language, and what it means. */
function ScopeBadge({ scope }: Readonly<{ scope: string }>) {
  const t = useT();
  const hint = scopeHint(t, scope);
  return (
    <Badge variant="outline" title={hint}>
      {scopeName(t, scope)}
      {hint && <span className="sr-only">: {hint}</span>}
    </Badge>
  );
}

export const PluginsPage = memo(function PluginsPage(props: { store: AppStore }) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, PLUGINSPAGE_KEYS);
  const host = state.hosts.find(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "plugins", false),
  );
  const hostId = host?.id;
  const [list, setList] = useState<PluginList | null>(null);
  const [failed, setFailed] = useState(false);
  const [looking, setLooking] = useState<InstalledPlugin | null>(null);
  const [installing, setInstalling] = useState<InstallSource | null>(null);
  const [folder, setFolder] = useState("");
  const [browsing, setBrowsing] = useState(false);
  /** The host answers `fs.dirs`: an older daemon does not, and there the folder is only typed. */
  const canBrowse = hasFeature(host?.hostInfo?.features, "fs.dirs", false);
  const [updating, setUpdating] = useState<InstalledPlugin | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
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
  const removePlugin = async (id: string, plugin: InstalledPlugin) => {
    const scope = isScope(plugin.scope) ? plugin.scope : undefined;
    const result = await store.hostCommand(id, "plugins.uninstall", {
      plugin: plugin.id,
      ...(scope ? { scope } : {}),
      confirm: true,
    });
    await done(t("pluginsUi.removed"), result?.outcome === "ok");
  };
  const addMarketplace = async (id: string) => {
    // With a device enrolled the add is signed in the system's dialog; a no, or a source that dialog cannot
    // show, sends nothing and keeps what was typed (#3516).
    let made: Awaited<ReturnType<typeof store.approval.marketplaceAddPayload>>;
    try {
      made = await store.approval.marketplaceAddPayload(id, { source: source.trim() });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      // The forms hint belongs to the signer's refusal of the source, not to a failed challenge or an offline host.
      store.reportError(
        why.includes("the dialog can show") ? `${why} ${t("pluginsUi.addSigningHint")}` : why,
      );
      return;
    }
    if (made.kind === "declined") return;
    const result = await store.hostCommand(id, "plugins.marketplaceAdd", made.payload);
    setSource("");
    await done(t("pluginsUi.marketplaceAdded"), result?.outcome === "ok");
  };
  const removeMarketplace = async (id: string, name: string) => {
    const result = await store.hostCommand(id, "plugins.marketplaceRemove", {
      name,
      confirm: true,
    });
    await done(t("pluginsUi.marketplaceRemoved"), result?.outcome === "ok");
  };
  const confirmed = async () => {
    const asked = asking;
    setAsking(null);
    if (!asked || !hostId) return;
    if (asked.kind === "remove") await removePlugin(hostId, asked.plugin);
    else if (asked.kind === "add") await addMarketplace(hostId);
    else await removeMarketplace(hostId, asked.name);
  };
  const refreshMarketplace = async (name: string) => {
    if (!hostId) return;
    const result = await store.hostCommand(hostId, "plugins.marketplaceUpdate", { name });
    await done(t("pluginsUi.marketplaceUpdated"), result?.outcome === "ok");
  };

  // `own`: the first load, or its Try again: the page has its own error, so the toast offers no
  // retry. After an action the list on screen stays, and so does the toast's retry.
  const reload = useCallback(
    async (own = false) => {
      if (!hostId) return;
      const result = await store.hostCommand(hostId, "plugins.list", {}, { retry: !own });
      // A refusal is not an empty host: keep what is on screen and say so only when nothing is.
      if (result) setList(result);
      setFailed(!result);
    },
    [store, hostId],
  );

  useEffect(() => {
    void reload(true);
  }, [reload]);

  /** What stands in for the tabs until a list is on screen. */
  const standIn = () => {
    if (!hostId) return <EmptyState title={t("pluginsUi.noHost")} />;
    if (failed) {
      return (
        <ErrorState
          message={t("pluginsUi.loadFailed")}
          retryLabel={t("pluginsUi.retry")}
          onRetry={() => void reload(true)}
        />
      );
    }
    return <LoadingState label={t("agent.loading")} />;
  };

  return (
    <Page
      title={t("pluginsUi.title")}
      subtitle={host ? t("pluginsUi.subtitle", { host: host.name }) : undefined}
    >
      {!hostId || list === null ? (
        standIn()
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
                        <ScopeBadge scope={plugin.scope} />
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
          message={askingWords(asking, source, t).message}
          confirmLabel={askingWords(asking, source, t).confirm}
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
