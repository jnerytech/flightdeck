import { CircleAlert, CircleX, Lock, MoreHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { requiredMissing } from "@/features/deps/index.ts";
import {
  hostDotView,
  hostInitial,
  hostRailLabel,
  hostVersionText,
} from "@/features/hosts/index.ts";
import { HostVersionTip } from "@/features/hosts/ui.ts";
import type { Key, T } from "@/i18n/index.ts";
import type { AppState, HostView } from "@/lib/app-store.ts";
import type { Route } from "@/lib/router.ts";
import { cn } from "@/lib/utils";
import { APP_VERSION, hasFeature } from "@/lib/version.ts";
import { IconTip } from "@/shared/feedback/index.ts";
import { StatusDot } from "@/shared/status/index.ts";

export const ITEM =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-normal text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The hosts of the Machines group: a dot each in the rail, a list with a menu each otherwise. */
export function HostsList(
  props: Readonly<{
    hosts: readonly HostView[];
    deps: AppState["deps"];
    collapsed: boolean;
    /** The host whose page is open, to mark its row as the current one. */
    hereHost: string | null;
    t: T;
    go(route: Route): void;
    /** The next navigation opens a new tab ("Abrir em nova aba"). */
    onNewTab(): void;
    onNewSession(hostId: string): void;
    onRename(host: HostView): void;
    onRemove(host: HostView): void;
  }>,
) {
  const { hosts, deps, collapsed, hereHost, t, go } = props;
  const versionOf = (host: HostView) =>
    hostVersionText(t, host.hostInfo?.daemonVersion, APP_VERSION);
  return collapsed ? (
    <div className="rail-hosts">
      {hosts.map((host) => (
        <IconTip key={host.id} label={hostRailLabel(host.name, versionOf(host))}>
          <button
            type="button"
            aria-label={t("sidebar.openHost", { host: host.name })}
            aria-current={hereHost === host.id ? "page" : undefined}
            className={cn("rail-host", hereHost === host.id && "nav-active bg-sidebar-accent")}
            onClick={() => go({ name: "host", host: host.id })}
          >
            <span data-slot="host-initial" aria-hidden="true" className="rail-host-initial">
              {hostInitial(host.name)}
            </span>
            <span className="rail-host-status">
              <HostDot host={host} t={t} />
            </span>
          </button>
        </IconTip>
      ))}
    </div>
  ) : (
    <ul className="host-list">
      {hosts.map((host) => (
        <li key={host.id} className="group host-row">
          <HostVersionTip text={versionOf(host)}>
            <button
              type="button"
              className={cn(
                ITEM,
                "min-w-0 flex-1",
                hereHost === host.id &&
                  "nav-active bg-sidebar-accent font-medium text-sidebar-foreground",
              )}
              aria-current={hereHost === host.id ? "page" : undefined}
              aria-label={t("sidebar.openHost", { host: host.name })}
              onClick={() => go({ name: "host", host: host.id })}
            >
              <HostDot host={host} t={t} />
              <span className="min-w-0 flex-1 truncate">{host.name}</span>
            </button>
          </HostVersionTip>
          {host.hostInfo?.ui?.mode === "simple" && (
            <span data-slot="host-mode-badge" className="host-mode-badge">
              {t("sidebar.hostSimple")}
            </span>
          )}
          {host.hostInfo?.ui?.locked === true && (
            <Lock
              role="img"
              aria-label={t("sidebar.hostLocked", { host: host.name })}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          {requiredMissing(deps[host.id]) && (
            <CircleX
              role="img"
              aria-label={t("hostDeps.badge", { host: host.name })}
              className="size-3.5 shrink-0 text-status-error"
            />
          )}
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
            />
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
              <DropdownMenuItem
                onSelect={() => {
                  props.onNewTab();
                  go({ name: "host", host: host.id });
                }}
              >
                {t("tabs.openInNew")}
              </DropdownMenuItem>
              {host.status !== "incompatible" && (
                <>
                  <DropdownMenuItem onSelect={() => go({ name: "history", host: host.id })}>
                    {t("sidebar.hostHistory")}
                  </DropdownMenuItem>
                  {hasFeature(host.hostInfo?.features, "workflows", true) && (
                    <DropdownMenuItem onSelect={() => go({ name: "projects", host: host.id })}>
                      {t("sidebar.hostProjects")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => props.onNewSession(host.id)}>
                    {t("sidebar.newSession")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onSelect={() => props.onRename(host)}>
                {t("hostPage.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onRemove(host)}>
                {t("sidebar.removeHost")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  );
}

/** A host's connection state as a dot. */
function HostDot(props: Readonly<{ host: HostView; t: T }>) {
  return (
    <StatusDot
      dot
      {...hostDotView(props.host.status)}
      label={props.t("sidebar.hostState", {
        host: props.host.name,
        state: props.t(`hosts.status.${props.host.status}` as Key),
      })}
    />
  );
}
