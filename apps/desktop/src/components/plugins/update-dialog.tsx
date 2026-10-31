import type { PluginChange, PluginUpdatePreview } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { InventoryView } from "./inventory-view";

const KINDS = ["hooks", "monitors", "skills", "agents", "commands", "mcpServers"] as const;

/**
 * Phase 26: an update, with what changes in what the plugin installs. Confirming repeats the hash
 * of the new content; what the CLI then leaves is hashed again, and undone if it differs.
 */
export function UpdateDialog(props: {
  store: AppStore;
  hostId: string;
  plugin: { id: string; name: string };
  onClose(): void;
  onDone(): void;
}) {
  const t = useT();
  const { store, hostId, plugin } = props;
  const [preview, setPreview] = useState<PluginUpdatePreview | null | undefined>(undefined);
  const [change, setChange] = useState<PluginChange | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void store.hostCommand(hostId, "plugins.previewUpdate", { plugin: plugin.id }).then(setPreview);
  }, [store, hostId, plugin.id]);

  const update = async (acceptCommand?: string) => {
    if (!preview) return;
    setBusy(true);
    const result = await store.hostCommand(hostId, "plugins.update", {
      plugin: plugin.id,
      confirmHash: preview.to.hash,
      ...(acceptCommand ? { acceptCommand } : {}),
    });
    setBusy(false);
    if (!result) return;
    setChange(result);
    if (result.outcome === "ok") {
      store.success(t("pluginsUi.updated"));
      props.onDone();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pluginsUi.update", { name: plugin.name })}</DialogTitle>
          <DialogDescription>{t("pluginsUi.updateHint")}</DialogDescription>
        </DialogHeader>
        {preview === undefined && <LoadingState label={t("agent.loading")} />}
        {preview === null && (
          <InlineNotice tone="error">{t("pluginsUi.noUpdatePreview")}</InlineNotice>
        )}
        {preview && (
          <div className="flex flex-col gap-3">
            {preview.unchanged ? (
              <p className="text-sm">{t("pluginsUi.upToDate")}</p>
            ) : (
              <>
                <p className="text-sm">
                  {preview.from.version} → {preview.to.version}
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {KINDS.flatMap((kind) => [
                    ...preview.diff[kind].added.map((item) => ({ way: "in", kind, item })),
                    ...preview.diff[kind].removed.map((item) => ({ way: "out", kind, item })),
                  ]).map(({ way, kind, item }) => (
                    <li key={`${way}/${kind}/${item}`}>
                      {way === "in" ? t("pluginsUi.diffIn") : t("pluginsUi.diffOut")} ·{" "}
                      {t(`pluginsUi.diff.${kind}`)}: {item}
                    </li>
                  ))}
                </ul>
                <InventoryView inventory={preview.inventory} />
              </>
            )}
          </div>
        )}
        {change?.outcome === "needs-command-confirmation" && change.shownCommand && (
          <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <p>{t("pluginsUi.commandShown")}</p>
            <code className="break-all">{change.shownCommand.command}</code>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void update(change.shownCommand?.sha256)}
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
          {preview &&
            !preview.unchanged &&
            change?.outcome !== "needs-command-confirmation" &&
            change?.outcome !== "rolled-back" && (
              <Button disabled={busy} onClick={() => void update()}>
                {t("pluginsUi.updateConfirm")}
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
