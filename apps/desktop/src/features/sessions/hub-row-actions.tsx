import type { SessionMeta } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import type { HubRow } from "./domain/hub.ts";
import { rowOffers } from "./domain/hub-derive.ts";
import { focusRenameField } from "./rename-form";

/** What a row's actions menu reads and calls back: the hub keeps the rename and move state. */
export interface RowActionsContext {
  store: AppStore;
  /** The hosts, for the ones that can move a session (teleport). */
  hosts: AppState["hosts"];
  teleportPreview: boolean;
  /** The row whose rename form is open, if any. */
  renaming: HubRow | null;
  onOpen(row: HubRow): void;
  onRename(row: HubRow): void;
  onMove(row: HubRow): void;
}

/** Pins, archives or renames a session on its host. */
export const setRowMeta = (store: AppStore, row: HubRow, patch: Partial<SessionMeta>) =>
  void store.sessionLists.setMeta(row.hostId, row.claudeSessionId as string, patch);

const canTeleport = (hosts: AppState["hosts"], hostId: string) =>
  hasFeature(hosts.find((h) => h.id === hostId)?.hostInfo?.features, "teleport", false);

/** The key notifications use for this session: the host's own id, else the Claude one. */
const sessionKeyOf = (row: HubRow) => `${row.hostId}/${row.sessionId ?? row.claudeSessionId}`;

/**
 * The row's actions menu, the same in a line and on a card. A function, not a component: the hub
 * subscribes to the mutes (`store.notifyPrefs`), so a change of them draws the menu again: a caller
 * that does not subscribe shows a stale Mute label.
 */
export function rowActions(ctx: RowActionsContext, row: HubRow) {
  const { store, hosts, teleportPreview, renaming, onOpen, onRename, onMove } = ctx;
  const { t } = store.i18n;
  const isMuted = (r: HubRow) => store.notifyPrefs.value.mutedSessions.includes(sessionKeyOf(r));
  if (!row.claudeSessionId) return null;
  const offers = rowOffers(row, {
    teleportPreview,
    canTeleport: () => canTeleport(hosts, row.hostId),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("hub.actions", { title: row.title })}
          data-row-actions={row.claudeSessionId}
          className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Rename opens a form: the menu hands it the focus, not back to its own button.
        onCloseAutoFocus={(event) => {
          if (renaming?.claudeSessionId !== row.claudeSessionId) return;
          event.preventDefault();
          focusRenameField();
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            store.hostTabs.openNextInNewTab();
            onOpen(row);
          }}
        >
          {t("tabs.openInNew")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRename(row)}>{t("hub.rename")}</DropdownMenuItem>
        {offers.sleep && (
          <DropdownMenuItem
            onSelect={() => void store.commands.sleep(row.hostId, row.sessionId as string)}
          >
            {t("hub.sleepNow")}
          </DropdownMenuItem>
        )}
        {offers.teleport && (
          <DropdownMenuItem onSelect={() => onMove(row)}>{t("teleportUi.menu")}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setRowMeta(store, row, { pinned: !row.pinned })}>
          {row.pinned ? t("hub.unpin") : t("hub.pin")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => store.notifyPrefs.muteSession(sessionKeyOf(row), !isMuted(row))}
        >
          {isMuted(row) ? t("notifyPrefs.unmuteSession") : t("notifyPrefs.mutedLabel")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            store.notifyPrefs.snooze(sessionKeyOf(row), store.now() + 3_600_000, store.now())
          }
        >
          {t("notifyPrefs.snooze")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setRowMeta(store, row, { archived: !row.archived })}>
          {row.archived ? t("hub.unarchive") : t("hub.archive")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void store.system.copyText(`flightdeckd claude --resume ${row.claudeSessionId}`)
          }
        >
          {t("hub.copyCommand")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
