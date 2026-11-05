import type { AccountState } from "@flightdeck/protocol";
import { BookOpen, ChevronsUpDown, ExternalLink, LogOut, Settings, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { T } from "../../i18n/index.ts";
import type { Route } from "../../lib/router.ts";

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The foot of the sidebar: the Claude account (its email and plan, from the account card) and a
 * menu with Settings, the theme and the manual. The rail shows only the initial.
 */
export function AccountFooter(props: {
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
}) {
  const { t, account } = props;
  const name =
    props.many > 1
      ? t("sidebarAccount.many", { n: props.many })
      : (account?.name ?? t("sidebarAccount.none"));
  const plan =
    props.many > 1
      ? t("sidebarAccount.manyHint")
      : account?.plan
        ? t("sidebarAccount.plan", { plan: capitalized(account.plan) })
        : t("sidebarAccount.unread");
  const label = t("sidebarAccount.menu", { name });
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
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs"
          >
            {name.charAt(0).toUpperCase()}
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
        <DropdownMenuItem onSelect={() => props.go({ name: "settings" })}>
          <Settings aria-hidden="true" />
          {t("sidebar.settings")}
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
