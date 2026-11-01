import { Briefcase } from "lucide-react";
import { ClientDot } from "@/components/clients/client-dot";
import { Inline } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppState, AppStore, PendingItem } from "../../lib/app-store.ts";
import { ALL_CLIENTS } from "../../lib/client-scope.ts";
import { switcherCounts } from "../../lib/client-switcher.ts";
import { UNASSIGNED } from "../../lib/clients.ts";
import { hubRows } from "../../lib/hub.ts";
import type { Route } from "../../lib/router.ts";

const Count = ({ n }: { n: number }) =>
  n > 0 ? <span className="ml-auto text-muted-foreground text-xs tabular-nums">{n}</span> : null;

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
    <Inline gap={1}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("clients.switcher", { name })}
            title={name}
            className="min-w-0 flex-1 justify-start"
          >
            {selected ? <ClientDot color={selected.color} /> : <Briefcase aria-hidden="true" />}
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{name}</span>}
          </Button>
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
        <Badge
          role="img"
          aria-label={t("clients.othersWaiting", { count: counts.othersWaiting })}
          className="tabular-nums"
        >
          {counts.othersWaiting}
        </Badge>
      )}
    </Inline>
  );
}
