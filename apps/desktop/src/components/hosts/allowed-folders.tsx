import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { hostDownReason } from "@/components/hosts/host-down-reason";
import { FieldRow } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { isLocalUrl } from "@/lib/terminal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** The folders a host lets its sessions and projects use, and a way to add one (the host decides). */
export function AllowedFolders(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [folder, setFolder] = useState("");
  const [asking, setAsking] = useState(false);
  const roots = host.info?.allowedRoots ?? [];
  // Issue #181: an offline host cannot take a folder; the row says so instead of "type the folder".
  const online = host.status === "online";
  const offlineReason = hostDownReason(host.status, host.name, t);
  return (
    <Panel title={t("hostPage.rootsTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.rootsHint")}</p>
      <ul aria-label={t("hostPage.rootsList")} className="flex flex-col gap-1 font-mono text-xs">
        {roots.map((root) => (
          <li key={root}>{root}</li>
        ))}
      </ul>
      <FieldRow>
        <Input
          aria-label={t("hostPage.rootsInput")}
          placeholder={t("hostPage.rootsPlaceholder")}
          className="w-80"
          disabled={!online}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
        {/* The system's dialog browses THIS machine's folders: only for a host that runs here. */}
        {store.canPickFolder() && isLocalUrl(host.url) && (
          <ActionButton
            variant="outline"
            disabled={!online}
            disabledReason={offlineReason}
            onClick={async () => {
              const picked = await store.pickFolder();
              if (picked) setFolder(picked);
            }}
          >
            {t("hostPage.rootsChoose")}
          </ActionButton>
        )}
        <ActionButton
          variant="outline"
          disabled={!online || !folder.trim()}
          disabledReason={online ? t("hostPage.rootsNeeded") : offlineReason}
          onClick={() => setAsking(true)}
        >
          {t("toast.allowRoot")}
        </ActionButton>
      </FieldRow>
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
