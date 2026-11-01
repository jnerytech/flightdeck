import { Briefcase } from "lucide-react";
import { ClientDot } from "@/components/clients/client-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AppState, AppStore, PendingItem } from "../../lib/app-store.ts";
import { ALL_CLIENTS } from "../../lib/client-scope.ts";
import { switcherCounts } from "../../lib/client-switcher.ts";
import { UNASSIGNED } from "../../lib/clients.ts";
import { hubRows } from "../../lib/hub.ts";
import type { Route } from "../../lib/router.ts";

const Count = ({ n }: { n: number }) =>
  n > 0 ? (
    <span className="ml-auto pl-3 text-muted-foreground text-xs tabular-nums">{n}</span>
  ) : null;

/**
 * The client in use, at the top of the sidebar: a button with the client's dot and name, and a
 * menu to change it. It is not there while no client exists. A request waiting in another client
 * puts a mark beside it, so a selection never hides what needs the user.
 */
export function ClientSwitcher(props: {
  store: AppStore;
  state: AppState;
  pending: PendingItem[];
  collapsed: boolean;
  go(route: Route): void;
}) {
  const { store, state, pending, collapsed, go } = props;
  const { t } = store.i18n;
  if (state.clientList.length === 0) return null;
  const selection = state.clientSelection;
  const selected = state.clientList.find((c) => c.id === selection);
  const name =
    selection === UNASSIGNED
      ? t("clients.unassigned")
      : (selected?.name ?? t("clients.allClients"));
  const counts = switcherCounts(store.clientScope(), hubRows(state), pending, selection);

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("clients.switcher", { name })}
            title={name}
            className={cn(
              "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "justify-center px-0",
            )}
          >
            {selected ? (
              <ClientDot color={selected.color} />
            ) : (
              <Briefcase aria-hidden="true" className="size-4 shrink-0" />
            )}
            {!collapsed && <span className="min-w-0 flex-1 truncate">{name}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={selection}
            onValueChange={(value) => store.setClientSelection(value)}
          >
            <DropdownMenuRadioItem value={ALL_CLIENTS}>
              {t("clients.allClients")}
            </DropdownMenuRadioItem>
            {state.clientList.map((client) => (
              <DropdownMenuRadioItem key={client.id} value={client.id}>
                <ClientDot color={client.color} />
                {client.name}
                <Count n={counts.busy[client.id] ?? 0} />
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={UNASSIGNED}>
              {t("clients.unassigned")}
              <Count n={counts.projects} />
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => go({ name: "clients" })}>
            {t("clients.manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {counts.othersWaiting > 0 && (
        <span
          role="img"
          aria-label={t("clients.othersWaiting", { count: counts.othersWaiting })}
          className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-status-needs-you px-1 text-[10px] text-background tabular-nums"
        >
          {counts.othersWaiting}
        </span>
      )}
    </div>
  );
}
