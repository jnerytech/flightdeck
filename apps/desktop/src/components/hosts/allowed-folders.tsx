import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** The folders a host lets its sessions and projects use, and a way to add one (the host decides). */
export function AllowedFolders(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [folder, setFolder] = useState("");
  const [asking, setAsking] = useState(false);
  const roots = host.info?.allowedRoots ?? [];
  return (
    <Panel title={t("hostPage.rootsTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.rootsHint")}</p>
      <ul aria-label={t("hostPage.rootsList")} className="flex flex-col gap-1 font-mono text-xs">
        {roots.map((root) => (
          <li key={root}>{root}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("hostPage.rootsInput")}
          className="w-80"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
        <ActionButton
          variant="outline"
          disabled={!folder.trim() || host.status !== "online"}
          disabledReason={t("hostPage.rootsNeeded")}
          onClick={() => setAsking(true)}
        >
          {t("toast.allowRoot")}
        </ActionButton>
      </div>
      {asking && (
        <ConfirmDialog
          message={t("toast.allowRootMessage", { host: host.name, folder: folder.trim() })}
          confirmLabel={t("toast.allowRoot")}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void store.allowRoot(host.id, folder.trim()).then((ok) => ok && setFolder(""));
          }}
        />
      )}
    </Panel>
  );
}
