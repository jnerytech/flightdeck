import {
  ArrowLeft,
  ArrowRight,
  ChevronsUpDown,
  CircleAlert,
  Moon,
  Plus,
  Search,
  Server,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { IconTip } from "@/components/feedback/icon-tip";
import { HostDot } from "@/components/hosts/host-dot";
import { ShortcutKeys } from "@/components/shortcuts/keycap";
import { StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Key, T } from "@/i18n/index";
import { hostDotView } from "@/lib/host-status";
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
    /** The tab row shows every host's tabs, grouped by host. */
    allHosts?: boolean;
    onAllHosts?(on: boolean): void;
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
            {/* Narrow, the name gives its room to the crumbs: the dot and the initial stay, and the
                button names the host. With no host, the server icon stands in. */}
            {current ? (
              <>
                <HostDot hostId={current.id} />
                <span
                  data-slot="top-bar-host-initial"
                  aria-hidden="true"
                  className="top-bar-host-initial"
                >
                  {initialOf(current.name)}
                </span>
              </>
            ) : (
              <Server aria-hidden="true" className="top-bar-host-icon" />
            )}
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
            {props.onAllHosts && props.hosts.length > 1 && (
              <>
                <DropdownMenuCheckboxItem
                  checked={props.allHosts ?? false}
                  onCheckedChange={(on) => props.onAllHosts?.(on === true)}
                >
                  {t("shell.allHostsTabs")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
              </>
            )}
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

/** The first letter of a host's name, upper case, for the narrow switcher. */
function initialOf(name: string): string {
  return ([...name.trim()][0] ?? "").toUpperCase();
}

/**
 * Back and forward through the history. They sit in the top bar, and below 640 px in the sidebar's
 * drawer, so the bar keeps its room (issue #641).
 */
export function HistoryButtons(
  props: Readonly<{
    t: T;
    canBack: boolean;
    canForward: boolean;
    onBack(): void;
    onForward(): void;
  }>,
) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={props.t("nav.back")}
        disabled={!props.canBack}
        onClick={props.onBack}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={props.t("nav.forward")}
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        <ArrowRight aria-hidden="true" />
      </Button>
    </>
  );
}

/** One host of the switcher's menu: its state, and its daemon's version, marked when not the app's. */
function HostItem(props: Readonly<{ host: TopBarHostItem; appVersion: string | undefined; t: T }>) {
  const { host, t } = props;
  const state = t(`hosts.status.${host.status}` as Key);
  const version = host.version ?? null;
  const differs =
    version !== null && props.appVersion !== undefined && version !== props.appVersion;
  const withVersion = differs ? "shell.hostItemDiffers" : "shell.hostItemVersion";
  const label =
    version === null
      ? t("shell.hostItem", { host: host.name, state })
      : t(withVersion, { host: host.name, state, version, app: props.appVersion ?? "" });
  return (
    <DropdownMenuRadioItem value={host.id} aria-label={label}>
      <StatusDot dot {...hostDotView(host.status)} label={state} />
      <HostDot hostId={host.id} />
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
    onSearch(): void;
    onToggleTheme(): void;
  }>,
) {
  const { t } = props;
  const toTheme = props.theme === "dark" ? t("shell.toLight") : t("shell.toDark");
  return (
    <div className="top-bar-actions">
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
