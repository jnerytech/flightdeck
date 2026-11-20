import type { PluginChange, PluginPreview } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { AppDialogContent, InlineNotice } from "@/shared/feedback/index.ts";
import { LoadingState } from "@/shared/layout/index.ts";
import { InventoryView } from "./inventory-view.tsx";

export type InstallSource = { plugin: string } | { dir: string };

/**
 * Phase 26: what a plugin brings, before anything is installed. The install repeats the hash of
 * the content shown here; a command the marketplace declares is shown too, and only that one,
 * by its own sha256, is accepted. Nothing is ever installed with a blanket "yes".
 */
export function InstallDialog(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    source: InstallSource;
    onClose(): void;
    onDone(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, source } = props;
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [change, setChange] = useState<PluginChange | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void store.hostCommand(hostId, "plugins.preview", source).then(setPreview);
  }, [store, hostId, source]);

  const name = preview?.plugin ?? ("plugin" in source ? source.plugin : source.dir);
  const shortName = name.split("@")[0] ?? name;
  const validation = preview?.validation;
  const refused = validation !== undefined && !validation.success;
  const canInstall = preview?.hash != null && !refused && change?.outcome !== "ok";

  const install = async (acceptCommand?: string) => {
    if (!preview?.hash) return;
    setBusy(true);
    // With a device enrolled, each call is signed in the system's dialog; a no sends nothing (#3516).
    let made: Awaited<ReturnType<typeof store.approval.pluginInstallPayload>>;
    try {
      made = await store.approval.pluginInstallPayload(hostId, {
        ...source,
        confirmHash: preview.hash,
        ...(acceptCommand ? { acceptCommand } : {}),
      });
    } catch (error) {
      setBusy(false);
      store.reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (made.kind === "declined") {
      setBusy(false);
      return;
    }
    const result = await store.hostCommand(hostId, "plugins.install", made.payload);
    setBusy(false);
    if (!result) return;
    setChange(result);
    if (result.outcome === "ok") {
      store.success(t("pluginsUi.installed"));
      props.onDone();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{t("pluginsUi.install", { name: shortName })}</DialogTitle>
          <DialogDescription>{t("pluginsUi.installHint")}</DialogDescription>
        </DialogHeader>
        {preview === null && <LoadingState label={t("agent.loading")} />}
        {preview?.hash === null && (
          <InlineNotice tone="error">{t("pluginsUi.noPreview", { name: shortName })}</InlineNotice>
        )}
        {preview?.inventory && <InventoryView inventory={preview.inventory} />}
        {refused && (
          <InlineNotice tone="error">
            {t("pluginsUi.validateRefused")} {validation?.errors.join("; ")}
          </InlineNotice>
        )}
        {change?.outcome === "needs-command-confirmation" && change.shownCommand && (
          <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <p>{t("pluginsUi.commandShown")}</p>
            <code className="break-all">{change.shownCommand.command}</code>
            <p className="text-muted-foreground text-xs">
              sha256: {change.shownCommand.sha256.slice(0, 12)}
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void install(change.shownCommand?.sha256)}
            >
              {t("pluginsUi.acceptCommand")}
            </Button>
          </div>
        )}
        {change && (change.outcome === "failed" || change.outcome === "rolled-back") && (
          <InlineNotice tone="error">{change.message}</InlineNotice>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          {canInstall && change?.outcome !== "needs-command-confirmation" && (
            <Button disabled={busy} onClick={() => void install()}>
              {t("pluginsUi.installConfirm")}
            </Button>
          )}
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
