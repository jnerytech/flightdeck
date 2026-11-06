import { ChevronsUpDown, CircleAlert, Moon, Plus, Search, Server, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { IconTip } from "@/components/feedback/icon-tip";
import { ShortcutKeys } from "@/components/shortcuts/keycap";
import { Meter } from "@/components/status/meter";
import { StatusDot } from "@/components/status/status-dot";
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
import type { Key, T } from "@/i18n/index";
import type { AppState } from "@/lib/app-store";
import { hostDotView } from "@/lib/host-status";
import { type QuotaGlance, quotaGlance } from "@/lib/quota-glance";
import type { Route } from "@/lib/router";
import type { Theme } from "@/lib/theme";

/** A host as the top bar shows it: its name and how its connection is. */
export interface TopBarHostItem {
  id: string;
  name: string;
  status: "connecting" | "online" | "offline" | "unauthorized" | "incompatible";
  /** The daemon's version, once the host has said it (issue #281). */
  version?: string | null;
}

/**
 * The host switcher of the top bar (issue #282): the current host, and a menu of every host with
 * its state, to select one (what the new-session form and the simple mode follow), or add one.
 */
export function TopBarHost(
  props: Readonly<{
    hosts: TopBarHostItem[];
    currentId: string | null;
    /** The app's version, to mark a daemon on another one (issue #281). */
    appVersion?: string;
    t: T;
    onChoose(hostId: string): void;
    onAdd(): void;
  }>,
) {
  const { t } = props;
  const current = props.hosts.find((h) => h.id === props.currentId);
  const name = current ? t("shell.host", { host: current.name }) : t("shell.noHost");
  return (
    <DropdownMenu>
      <IconTip label={current?.name}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={name} className="top-bar-host">
            {/* Narrow, the name gives its room to the crumbs: the icon stays, named by the button. */}
            <Server aria-hidden="true" className="top-bar-host-icon" />
            <span className="top-bar-host-name">{current?.name ?? t("shell.noHost")}</span>
            <ChevronsUpDown aria-hidden="true" className="top-bar-host-chevron" />
          </Button>
        </DropdownMenuTrigger>
      </IconTip>
      <DropdownMenuContent align="start">
        {props.hosts.length > 0 && (
          <>
            <DropdownMenuRadioGroup
              value={props.currentId ?? ""}
              onValueChange={(id) => props.onChoose(id)}
            >
              {props.hosts.map((host) => (
                <HostItem key={host.id} host={host} appVersion={props.appVersion} t={t} />
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => props.onAdd()}>
          <Plus aria-hidden="true" />
          {t("sidebar.addHost")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One host of the switcher's menu: its state, and its daemon's version, marked when not the app's. */
function HostItem(props: Readonly<{ host: TopBarHostItem; appVersion: string | undefined; t: T }>) {
  const { host, t } = props;
  const state = t(`hosts.status.${host.status}` as Key);
  const version = host.version ?? null;
  const differs =
    version !== null && props.appVersion !== undefined && version !== props.appVersion;
  const label =
    version === null
      ? t("shell.hostItem", { host: host.name, state })
      : t(differs ? "shell.hostItemDiffers" : "shell.hostItemVersion", {
          host: host.name,
          state,
          version,
          app: props.appVersion ?? "",
        });
  return (
    <DropdownMenuRadioItem value={host.id} aria-label={label}>
      <StatusDot dot {...hostDotView(host.status)} label={state} />
      {host.name}
      {version !== null && (
        <span className={differs ? "top-bar-host-version-differs" : "top-bar-host-version"}>
          {differs && <CircleAlert aria-hidden="true" />}v{version}
        </span>
      )}
    </DropdownMenuRadioItem>
  );
}

/**
 * The right side of the top bar (issue #282): the search that opens the palette, the theme button
 * (named for what it switches to), the bell and the app's version. Narrow, the search is its icon.
 */
export function TopBarActions(
  props: Readonly<{
    t: T;
    theme: Theme;
    version: string;
    bell: ReactNode;
    /** The plan quota at a glance (issue #118), first on the right. */
    quota?: ReactNode;
    onSearch(): void;
    onToggleTheme(): void;
  }>,
) {
  const { t } = props;
  const toTheme = props.theme === "dark" ? t("shell.toLight") : t("shell.toDark");
  return (
    <div className="top-bar-actions">
      {props.quota}
      <Button
        variant="outline"
        size="sm"
        aria-label={t("shell.searchLabel")}
        aria-keyshortcuts="Control+K"
        className="top-bar-search"
        onClick={props.onSearch}
      >
        <Search aria-hidden="true" />
        <span className="top-bar-search-text">{t("shell.search")}</span>
        <ShortcutKeys keys={["Mod", "K"]} className="top-bar-search-keys" />
      </Button>
      <IconTip label={toTheme}>
        <Button variant="ghost" size="icon" aria-label={toTheme} onClick={props.onToggleTheme}>
          {props.theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </IconTip>
      {props.bell}
      <span className="top-bar-version">
        <span className="sr-only">{t("shell.version", { version: props.version })}</span>
        <span aria-hidden="true">v{props.version}</span>
      </span>
    </div>
  );
}

/**
 * The plan quota at a glance (issue #118): the window under most pressure across the online hosts,
 * as a small meter and its percent. Its name says the state in words, the host and when it resets;
 * near or at the limit a mark shows too, never colour alone. Pressing it opens that host.
 */
export function TopBarQuota(
  props: Readonly<{
    t: T;
    glance: QuotaGlance | null;
    hostName: string;
    onOpen(hostId: string): void;
  }>,
) {
  const { t, glance } = props;
  if (!glance) return null;
  const window = t(`account.windows.${glance.window}` as Key);
  const vars = {
    state: t(`shell.quotaLevels.${glance.level}` as Key),
    window,
    percent: String(glance.percent),
    host: props.hostName,
    remaining: glance.remaining,
  };
  const name = glance.remaining ? t("shell.quotaLabel", vars) : t("shell.quotaLabelNoReset", vars);
  return (
    <IconTip label={name}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={name}
        data-level={glance.level}
        className="top-bar-quota"
        onClick={() => props.onOpen(glance.hostId)}
      >
        {glance.level !== "ok" && <CircleAlert aria-hidden="true" data-mark="" />}
        <span className="top-bar-quota-window">{window}</span>
        <Meter
          label={window}
          value={Math.min(glance.percent, 100)}
          max={100}
          hot={glance.level === "reached"}
          className="h-1.5 w-10 [&::-webkit-meter-bar]:h-1.5"
        />
        <span>{glance.percent}%</span>
      </Button>
    </IconTip>
  );
}

/** Issue #118: the glance of the app's state, in the top bar. */
export function TopBarQuotaSlot(
  props: Readonly<{
    t: T;
    state: Pick<AppState, "hosts" | "quota">;
    now: number;
    go(route: Route): void;
  }>,
) {
  const online = props.state.hosts.filter((host) => host.status === "online");
  const glance = quotaGlance(
    props.state.quota,
    online.map((host) => host.id),
    props.now,
  );
  const host = online.find((h) => h.id === glance?.hostId);
  return (
    <TopBarQuota
      t={props.t}
      glance={glance}
      hostName={host?.name ?? ""}
      onOpen={(hostId) => props.go({ name: "host", host: hostId })}
    />
  );
}
