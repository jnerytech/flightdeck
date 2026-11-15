import { Search, Sparkles } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { type GithubHost, githubSignedIn } from "@/features/hosts/index.ts";
import { ShortcutKeys } from "@/features/shortcuts/ui.ts";
import type { T } from "@/i18n/index.ts";
import type { AppState, AppStore } from "@/lib/app-store.ts";
import type { Route } from "@/lib/router.ts";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { AccountFooter } from "./account-footer.tsx";
import { footAccount } from "./domain/foot-account.ts";
import { NavButton, NavIcon } from "./sidebar-nav.tsx";

const ICON = "size-4 shrink-0";

/** The sidebar's footer: search, settings, the account menu and the simple-mode switch. */
export function SidebarFoot(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "hosts" | "account">;
    collapsed: boolean;
    t: T;
    go(route: Route): void;
    route?: Route;
    version: string;
    /** What the person hid from the account menu; the sidebar reads it too, for the badges. */
    shellPrefs: AppStore["shellPrefs"]["value"];
    /** The setup checklist is hidden; the sidebar reads it too, for the checklist. */
    setupHidden: boolean;
    /** Settings is the open screen. */
    settingsActive: boolean;
    onOpenSearch(): void;
    onToggleTheme(): void;
    onShortcuts?(): void;
    onWhatsNew?(): void;
    onSimpleMode?(): void;
  }>,
) {
  const { store, state, t, collapsed, go, shellPrefs } = props;
  const [githubHosts, setGithubHosts] = useState<GithubHost[]>([]);
  const [signingOut, setSigningOut] = useState<GithubHost | null>(null);
  /** The Claude account the foot shows: the open host's, how many differ, none from an offline host. */
  const foot = footAccount(state, props.route);
  // Release notes the person has not opened since the app was updated: a dot on the account row.
  const whatsNewDot = useSyncExternalStore(store.whatsNew.subscribe, () => store.whatsNew.hasNew());
  const density = useSyncExternalStore(store.density.subscribe, () => store.density.value);
  return (
    <>
      <div data-slot="sidebar-foot" className="flex flex-col gap-0.5 border-t pt-2">
        <NavButton
          collapsed={collapsed}
          icon={<Search aria-hidden="true" className={ICON} />}
          label={t("sidebar.search")}
          name={t("sidebar.searchLabel")}
          hint="Ctrl K"
          keys="Control+K"
          onClick={props.onOpenSearch}
          tail={<ShortcutKeys keys={["Mod", "K"]} className="text-muted-foreground" />}
        />
        <NavButton
          collapsed={collapsed}
          icon={<NavIcon name="settings" aria-hidden="true" className={ICON} />}
          active={props.settingsActive}
          label={t("sidebar.settings")}
          chevron
          onClick={() => go({ name: "settings" })}
        />
        <AccountFooter
          account={foot.account}
          many={foot.many}
          githubHosts={githubHosts}
          onOpen={() => void githubSignedIn(store, state.hosts).then(setGithubHosts)}
          onSignOutGithub={(hostId) =>
            setSigningOut(githubHosts.find((host) => host.id === hostId) ?? null)
          }
          collapsed={collapsed}
          t={t}
          go={go}
          onToggleTheme={props.onToggleTheme}
          hostId={foot.hostId}
          version={props.version}
          density={density}
          onDensity={(next) => store.density.set(next)}
          onCopy={(text) => void store.system.copyText(text)}
          hideBadges={shellPrefs.hideBadges}
          onHideBadges={(hide) => store.shellPrefs.set({ hideBadges: hide })}
          hideWhatsNew={shellPrefs.hideWhatsNew}
          onHideWhatsNew={(hide) => store.shellPrefs.set({ hideWhatsNew: hide })}
          hideSetup={props.setupHidden}
          onHideSetup={(hide) => store.setup.setHidden(hide)}
          onCheckUpdates={() => {
            go({ name: "settings" });
            void store.appUpdates.check();
          }}
          onShortcuts={() => props.onShortcuts?.()}
          hasNew={whatsNewDot && !shellPrefs.hideWhatsNew}
          onWhatsNew={() => props.onWhatsNew?.()}
          onOpenManual={() => {
            const page = t.lang === "pt-BR" ? "pt-BR" : "en";
            const url = `https://github.com/jnerytech/flightdeck/blob/main/docs/manual/${page}.md`;
            void store.openLink(url); // NOSONAR: the promise is deliberately not awaited; void says so
          }}
        />
        {props.onSimpleMode && (
          <NavButton
            collapsed={collapsed}
            icon={<Sparkles aria-hidden="true" className={ICON} />}
            label={t("sidebar.simpleMode")}
            onClick={props.onSimpleMode}
          />
        )}
      </div>
      {signingOut && (
        <ConfirmDialog
          message={t("sidebarAccount.signOutGithubConfirm", { host: signingOut.name })}
          confirmLabel={t("sidebarAccount.signOutGithub")}
          destructive
          onConfirm={() => {
            const host = signingOut;
            setSigningOut(null);
            setGithubHosts((hosts) => hosts.filter((h) => h.id !== host.id));
            void store.hostCommand(host.id, "github.logout", {});
          }}
          onCancel={() => setSigningOut(null)}
        />
      )}
    </>
  );
}
