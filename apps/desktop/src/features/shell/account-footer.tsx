import type { AccountState } from "@flightdeck/protocol";
import {
  BookOpen,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  Keyboard,
  LogOut,
  RefreshCw,
  Settings,
  Sparkles,
  SunMoon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Key, T } from "../../i18n/index.ts";
import type { Density } from "../../lib/density.ts";
import type { Route } from "../../lib/router.ts";

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The foot of the sidebar: the Claude account (its email and plan, from the account card) and a
 * menu (issue #282): the app and its version; the plan, the account and the host id, each copied by
 * choosing it; the compact rows switch kept on this computer; Settings, Check for updates, Keyboard
 * shortcuts, the theme, the manual and the GitHub sign-outs. The rail shows only the initial.
 */
export function AccountFooter(
  props: Readonly<{
    account: AccountState | null;
    /** More than one different account and none chosen: how many (0 otherwise). */
    many: number;
    collapsed: boolean;
    t: T;
    go(route: Route): void;
    onToggleTheme(): void;
    onOpenManual(): void;
    /** The menu opened: the caller looks up who is signed in to GitHub. */
    onOpen(): void;
    /** Hosts signed in to GitHub that the app can sign out. */
    githubHosts: Array<{ id: string; name: string }>;
    onSignOutGithub(hostId: string): void;
    /** The host whose account is shown, copied from the menu; `null` with none. */
    hostId: string | null;
    /** The app's version, in the menu's header. */
    version: string;
    density: Density;
    onDensity(density: Density): void;
    onCopy(text: string): void;
    /** The switches kept on this computer: what the shell hides (issue #282). */
    hideBadges: boolean;
    onHideBadges(hide: boolean): void;
    hideWhatsNew: boolean;
    onHideWhatsNew(hide: boolean): void;
    hideSetup: boolean;
    onHideSetup(hide: boolean): void;
    onCheckUpdates(): void;
    /** There are release notes the person has not opened since the update (issue #125). */
    hasNew: boolean;
    onWhatsNew(): void;
    onShortcuts(): void;
  }>,
) {
  const { t, account } = props;
  const name =
    props.many > 1
      ? t("sidebarAccount.many", { n: props.many })
      : (account?.name ?? t("sidebarAccount.none"));
  const knownPlan = account?.plan ? capitalized(account.plan) : null;
  const plan = (() => {
    if (props.many > 1) return t("sidebarAccount.manyHint");
    return knownPlan ? t("sidebarAccount.plan", { plan: knownPlan }) : t("sidebarAccount.unread");
  })();
  const label = props.hasNew
    ? t("sidebarAccount.menuNew", { name })
    : t("sidebarAccount.menu", { name });
  const planName = props.many > 1 ? null : knownPlan;
  const facts = [
    { key: "copyPlan", value: planName },
    { key: "copyAccount", value: props.many > 1 ? null : (account?.name ?? null) },
    { key: "copyHost", value: props.hostId },
  ].flatMap((fact) => (fact.value ? [{ key: fact.key, value: fact.value }] : []));
  return (
    <DropdownMenu onOpenChange={(open) => open && props.onOpen()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          data-slot="account-trigger"
          aria-label={label}
          className="h-auto w-full justify-start gap-2 px-2 py-2 font-normal"
        >
          <span
            aria-hidden="true"
            className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs"
          >
            {name.charAt(0).toUpperCase()}
            {props.hasNew && (
              <span
                data-slot="new-dot"
                className="absolute top-0 right-0 size-2.5 rounded-full bg-status-needs-you ring-2 ring-sidebar"
              />
            )}
          </span>
          {!props.collapsed && (
            <>
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-sm">{name}</span>
                <span className="truncate text-muted-foreground text-xs">{plan}</span>
              </span>
              <ChevronsUpDown
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        <DropdownMenuLabel className="flex items-baseline justify-between gap-3">
          <span>Flightdeck</span>
          <span className="font-normal text-muted-foreground text-xs">
            {t("sidebarAccount.version", { version: props.version })}
          </span>
        </DropdownMenuLabel>
        {facts.length > 0 && <DropdownMenuSeparator />}
        {facts.map((fact) => (
          <DropdownMenuItem key={fact.key} onSelect={() => props.onCopy(fact.value)}>
            <Copy aria-hidden="true" />
            <span className="min-w-0 truncate">
              {t(`sidebarAccount.${fact.key}` as Key, { value: fact.value })}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={props.density === "compact"}
          onCheckedChange={(on) => props.onDensity(on ? "compact" : "comfortable")}
        >
          {t("sidebarAccount.compact")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={props.hideBadges}
          onCheckedChange={(on) => props.onHideBadges(on === true)}
        >
          {t("sidebarAccount.hideBadges")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={props.hideWhatsNew}
          onCheckedChange={(on) => props.onHideWhatsNew(on === true)}
        >
          {t("sidebarAccount.hideWhatsNew")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={props.hideSetup}
          onCheckedChange={(on) => props.onHideSetup(on === true)}
        >
          {t("setup.hide")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => props.go({ name: "settings" })}>
          <Settings aria-hidden="true" />
          {t("sidebar.settings")}
        </DropdownMenuItem>
        {!props.hideWhatsNew && (
          <DropdownMenuItem onSelect={props.onWhatsNew}>
            <Sparkles aria-hidden="true" />
            {t("sidebarAccount.whatsNew")}
            {props.hasNew && (
              <span className="ml-auto rounded-full bg-status-needs-you/20 px-1.5 text-xs">
                {t("sidebarAccount.whatsNewBadge")}
              </span>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={props.onCheckUpdates}>
          <RefreshCw aria-hidden="true" />
          {t("sidebarAccount.checkUpdates")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onShortcuts}>
          <Keyboard aria-hidden="true" />
          {t("sidebarAccount.shortcuts")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onToggleTheme}>
          <SunMoon aria-hidden="true" />
          {t("sidebar.theme")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onOpenManual}>
          <BookOpen aria-hidden="true" />
          {t("sidebar.manual")}
          <ExternalLink data-slot="nav-external" aria-hidden="true" className="ml-auto size-3.5" />
        </DropdownMenuItem>
        {props.githubHosts.map((host) => (
          <DropdownMenuItem key={host.id} onSelect={() => props.onSignOutGithub(host.id)}>
            <LogOut aria-hidden="true" />
            {props.githubHosts.length > 1
              ? t("sidebarAccount.signOutGithubHost", { host: host.name })
              : t("sidebarAccount.signOutGithub")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
