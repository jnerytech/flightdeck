import {
  ChevronDown,
  CircleAlert,
  Coins,
  Columns3,
  History,
  Layers,
  MoreHorizontal,
  Plane,
  Plus,
  Search,
  Settings as SettingsIcon,
  SunMoon,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { StateTone } from "@/components/status/state-badge";
import { StatusDot } from "@/components/status/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Key, T } from "../i18n/index.ts";
import { type AppState, type HostView, needsYou } from "../lib/app-store.ts";
import { budgetAlerts } from "../lib/budgets.ts";
import type { ConnectionStatus } from "../lib/host-connection.ts";
import { hubRows } from "../lib/hub.ts";
import type { Route } from "../lib/router.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { rowRoute } from "./Screens.tsx";

/** A host's connection as the dot of a session state. */
const HOST_TONE: Record<ConnectionStatus, StateTone> = {
  online: "running",
  connecting: "needs-you",
  offline: "ended",
  unauthorized: "error",
  incompatible: "error",
};

const ITEM =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One line of the bar: an icon, its label (hidden in the rail, which keeps it as a tooltip) and a tail. */
function NavButton(props: {
  icon: ReactNode;
  label: string;
  /** The accessible name, when it is not the visible label. */
  name?: string;
  collapsed: boolean;
  onClick(): void;
  disabled?: boolean;
  tail?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(ITEM, props.collapsed && "justify-center px-0")}
      aria-label={props.name ?? (props.collapsed ? props.label : undefined)}
      title={props.collapsed ? props.label : undefined}
      disabled={props.disabled ?? false}
      onClick={props.onClick}
    >
      {props.icon}
      {!props.collapsed && <span className="min-w-0 flex-1 truncate">{props.label}</span>}
      {props.tail}
    </button>
  );
}

/** A section title that folds its list. */
function SectionTitle(props: {
  label: string;
  open: boolean;
  onToggle(): void;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pt-3">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="flex items-center gap-1 rounded-sm font-medium text-muted-foreground text-xs uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3 transition-transform duration-150", !props.open && "-rotate-90")}
        />
        {props.label}
      </button>
      {props.action}
    </div>
  );
}

/** The app's bar: logo, navigation, hosts, pinned sessions and the footer; a rail of icons when collapsed. */
export function Sidebar(props: {
  state: AppState;
  collapsed: boolean;
  t: T;
  go(route: Route): void;
  onSelectSession(hostId: string, sessionId: string | null): void;
  onRemoveHost(hostId: string): void;
  onOpenSearch(): void;
  onToggleTheme(): void;
}) {
  const { state, t, collapsed, go } = props;
  /** The host the screens that need one open on: the selected one, else the first online. */
  const navHost =
    (state.selected && state.hosts.find((h) => h.id === state.selected?.hostId)) ||
    state.hosts.find((h) => h.status === "online") ||
    state.hosts[0];
  const pending = needsYou(state).length + budgetAlerts(state).length;
  const pinned = hubRows(state).filter((row) => row.pinned && !row.archived);
  const [hostsOpen, setHostsOpen] = useState(true);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  /** The host whose removal is being confirmed. */
  const [removing, setRemoving] = useState<HostView | null>(null);
  const icon = "size-4 shrink-0";
  const needHost = (build: (hostId: string) => Route) => () => {
    if (navHost) go(build(navHost.id));
  };

  return (
    <div className="flex h-full flex-col gap-1 p-2">
      <div className={cn("flex h-8 items-center gap-2 px-2", collapsed && "justify-center px-0")}>
        <Plane data-logo aria-hidden="true" className="size-5 shrink-0 text-brand" />
        {!collapsed && <span className="font-semibold text-sm">Flightdeck</span>}
      </div>
      <nav className="flex flex-col gap-0.5">
        <NavButton
          collapsed={collapsed}
          icon={<Layers aria-hidden="true" className={icon} />}
          label={t("sidebar.sessions")}
          name={t("sidebar.openSessions")}
          onClick={() => go({ name: "hub" })}
        />
        <NavButton
          collapsed={collapsed}
          icon={<CircleAlert aria-hidden="true" className={icon} />}
          label={t("sidebar.needsYou")}
          onClick={() => go({ name: "needs-you" })}
          tail={
            pending > 0 && (
              <Badge className="h-4 min-w-4 px-1 tabular-nums" variant="default">
                {pending}
              </Badge>
            )
          }
        />
        <NavButton
          collapsed={collapsed}
          icon={<Columns3 aria-hidden="true" className={icon} />}
          label={t("sidebar.board")}
          disabled={!navHost}
          onClick={needHost((host) => ({ name: "projects", host }))}
        />
        <NavButton
          collapsed={collapsed}
          icon={<Workflow aria-hidden="true" className={icon} />}
          label={t("sidebar.workflows")}
          disabled={!navHost}
          onClick={needHost((host) => ({ name: "projects", host }))}
        />
        {/* Hosts from phase 8 on read their costs from the transcripts. */}
        {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "costs", false)) && (
          <NavButton
            collapsed={collapsed}
            icon={<Coins aria-hidden="true" className={icon} />}
            label={t("sidebar.costs")}
            onClick={() => go({ name: "costs" })}
          />
        )}
        <NavButton
          collapsed={collapsed}
          icon={<History aria-hidden="true" className={icon} />}
          label={t("sidebar.history")}
          disabled={!navHost}
          onClick={needHost((host) => ({ name: "history", host }))}
        />
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 pt-3">
            {state.hosts.map((host) => (
              <button
                key={host.id}
                type="button"
                aria-label={t("sidebar.openHost", { host: host.name })}
                title={host.name}
                className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent"
                onClick={() => go({ name: "host", host: host.id })}
              >
                <HostDot host={host} t={t} />
              </button>
            ))}
          </div>
        ) : (
          <>
            <SectionTitle
              label={t("sidebar.hosts")}
              open={hostsOpen}
              onToggle={() => setHostsOpen(!hostsOpen)}
              action={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("sidebar.addHost")}
                  onClick={() => go({ name: "add-host" })}
                >
                  <Plus />
                </Button>
              }
            />
            {hostsOpen && (
              <ul className="flex flex-col gap-0.5">
                {state.hosts.map((host) => (
                  <li key={host.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      className={cn(ITEM, "min-w-0 flex-1")}
                      aria-label={t("sidebar.openHost", { host: host.name })}
                      onClick={() => go({ name: "host", host: host.id })}
                    >
                      <HostDot host={host} t={t} />
                      <span className="min-w-0 flex-1 truncate">{host.name}</span>
                    </button>
                    {host.hostInfo?.apiKeySanitized === false && (
                      <TriangleAlert
                        role="img"
                        aria-label={t("sidebar.keyPassed", { host: host.name })}
                        className="size-3.5 shrink-0 text-status-needs-you"
                      />
                    )}
                    {host.hostInfo && host.hostInfo.daemonVersion !== APP_VERSION && (
                      <CircleAlert
                        role="img"
                        aria-label={t("sidebar.versionDiffers", { host: host.name })}
                        className="size-3.5 shrink-0 text-status-needs-you"
                      >
                        <title>
                          {t("sidebar.versionTitle", {
                            daemon: host.hostInfo.daemonVersion,
                            app: APP_VERSION,
                          })}
                        </title>
                      </CircleAlert>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label={t("sidebar.hostMenu", { host: host.name })}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {/* An incompatible host offers nothing but its page and removal. */}
                        {host.status !== "incompatible" && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => go({ name: "history", host: host.id })}
                            >
                              {t("sidebar.hostHistory")}
                            </DropdownMenuItem>
                            {hasFeature(host.hostInfo?.features, "workflows", true) && (
                              <DropdownMenuItem
                                onSelect={() => go({ name: "projects", host: host.id })}
                              >
                                {t("sidebar.hostProjects")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => props.onSelectSession(host.id, null)}>
                              {t("sidebar.newSession")}
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem onSelect={() => setRemoving(host)}>
                          {t("sidebar.removeHost")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
            {pinned.length > 0 && (
              <>
                <SectionTitle
                  label={t("sidebar.pinned")}
                  open={pinnedOpen}
                  onToggle={() => setPinnedOpen(!pinnedOpen)}
                />
                {pinnedOpen && (
                  <ul className="flex flex-col gap-0.5">
                    {pinned.map((row) => (
                      <li key={row.key}>
                        <button
                          type="button"
                          className={ITEM}
                          title={`${row.title} · ${row.hostName}`}
                          onClick={() => go(rowRoute(row))}
                        >
                          <span className="min-w-0 flex-1 truncate">{row.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-t pt-2">
        <NavButton
          collapsed={collapsed}
          icon={<Search aria-hidden="true" className={icon} />}
          label={t("sidebar.search")}
          name={t("sidebar.searchLabel")}
          onClick={props.onOpenSearch}
          tail={
            <kbd className="rounded border bg-background px-1 font-mono text-[11px] text-muted-foreground">
              Ctrl K
            </kbd>
          }
        />
        <NavButton
          collapsed={collapsed}
          icon={<SettingsIcon aria-hidden="true" className={icon} />}
          label={t("sidebar.settings")}
          onClick={() => go({ name: "settings" })}
        />
        <NavButton
          collapsed={collapsed}
          icon={<SunMoon aria-hidden="true" className={icon} />}
          label={t("sidebar.theme")}
          onClick={props.onToggleTheme}
        />
      </div>
      {removing && (
        <ConfirmDialog
          message={t("sidebar.removeConfirm", { host: removing.name })}
          confirmLabel={t("sidebar.removeHost")}
          destructive
          onConfirm={() => {
            props.onRemoveHost(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** A host's connection state as a dot. */
function HostDot(props: { host: HostView; t: T }) {
  return (
    <StatusDot
      tone={HOST_TONE[props.host.status]}
      label={props.t("sidebar.hostState", {
        host: props.host.name,
        state: props.t(`hosts.status.${props.host.status}` as Key),
      })}
    />
  );
}
