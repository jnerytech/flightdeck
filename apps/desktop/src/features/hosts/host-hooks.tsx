import type { HooksStatusResult } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { FieldRow, Panel } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { hostDownReason } from "./domain/host-down-reason.ts";

const HOOK_LABELS = {
  installed: "hostPage.hooksInstalled",
  absent: "hostPage.hooksAbsent",
  outdated: "hostPage.hooksOutdated",
} as const satisfies Record<HooksStatusResult["status"], Key>;

/**
 * The Claude Code hooks of a host: the status read, the install and uninstall, and the question
 * asked before either. The page puts `section` in Settings and `dialog` at its end; `refresh`
 * reads the status again for the Health section, which can install the hooks too.
 */
export function useHostHooks(
  store: AppStore,
  host: HostView,
): { refresh(): void; section: ReactNode; dialog: ReactNode } {
  const t = useT();
  const info = host.hostInfo;
  const [hooks, setHooks] = useState<HooksStatusResult | null>(null);
  const [confirming, setConfirming] = useState<"install" | "uninstall" | null>(null);
  const offline = host.status !== "online" && host.status !== "incompatible";
  const hooksKey = hooks ? HOOK_LABELS[hooks.status] : "hostPage.hooksAsking";
  useEffect(() => {
    if (host.status !== "online") return;
    void store.hostCommand(host.id, "hooks.status", {}).then(setHooks);
  }, [store, host.id, host.status]);
  const refresh = () => void store.hostCommand(host.id, "hooks.status", {}).then(setHooks);
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
  const section = showHooks && (
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
  );
  const dialog = confirming && (
    <ConfirmDialog
      message={
        confirming === "install"
          ? t("hostPage.installMessage", { path: settingsPath })
          : t("hostPage.uninstallMessage", { path: settingsPath })
      }
      confirmLabel={confirming === "install" ? t("hostPage.install") : t("hostPage.uninstall")}
      destructive={confirming === "uninstall"}
      onConfirm={() => void apply()}
      onCancel={() => setConfirming(null)}
    />
  );
  return { refresh, section, dialog };
}
