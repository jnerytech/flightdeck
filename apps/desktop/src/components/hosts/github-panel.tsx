import type { GithubLoginResult, GithubStatusResult } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";

/**
 * The host's GitHub sign-in (phase 37): the host's gh does the device flow and keeps the token, so
 * this panel only shows the one-time code and the page, and then who is signed in. No token here.
 */
export function GithubPanel(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [status, setStatus] = useState<GithubStatusResult | null>(null);
  const [device, setDevice] = useState<GithubLoginResult | null>(null);

  const refresh = useCallback(async () => {
    const next = await store.hostCommand(host.id, "github.status", {});
    if (next) setStatus(next);
    return next;
  }, [store, host.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the person confirms on GitHub, ask the host now and then whether gh is signed in.
  useEffect(() => {
    if (!device) return;
    return store.githubTicker(() => {
      void refresh().then((next) => {
        if (next?.loggedIn) setDevice(null);
      });
    });
  }, [device, refresh, store]);

  const signIn = async () => {
    const started = await store.hostCommand(host.id, "github.login.start", {});
    if (started) setDevice(started);
  };
  const cancel = async () => {
    await store.hostCommand(host.id, "github.login.cancel", {});
    setDevice(null);
    await refresh();
  };
  const signOut = async () => {
    await store.hostCommand(host.id, "github.logout", {});
    await refresh();
  };

  return (
    <Panel title={t("github.title")}>
      <p className="text-muted-foreground text-xs">{t("github.hint")}</p>
      {status && !status.installed && (
        <>
          <p role="status" className="text-sm">
            {t("github.notInstalled")}
          </p>
          <div>
            <ActionButton variant="outline" size="sm" onClick={async () => void (await refresh())}>
              {t("github.recheck")}
            </ActionButton>
          </div>
        </>
      )}
      {status?.installed && status.loggedIn && (
        <>
          <p role="status" className="text-sm">
            {t("github.signedIn", { login: status.login ?? "" })}
          </p>
          <p className="text-muted-foreground text-xs">
            {status.source ? t(`github.source.${status.source}`) : ""}
            {status.scopes.length > 0 &&
              ` · ${t("github.scopes", { scopes: status.scopes.join(", ") })}`}
          </p>
          <div>
            <ActionButton
              variant="outline"
              size="sm"
              disabled={status.source === "env"}
              disabledReason={t("github.signOutEnv")}
              onClick={signOut}
            >
              {t("github.signOut")}
            </ActionButton>
          </div>
        </>
      )}
      {status?.installed && !status.loggedIn && !device && (
        <>
          <p role="status" className="text-sm">
            {t("github.signedOut")}
          </p>
          <div>
            <ActionButton size="sm" onClick={signIn}>
              {t("github.signIn")}
            </ActionButton>
          </div>
        </>
      )}
      {status?.installed && !status.loggedIn && device && (
        <>
          <p className="text-sm">{t("github.codeHint")}</p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">{t("github.codeLabel")}</span>
            <code className="font-mono text-lg tracking-wider">{device.code}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void store.copyText(device.code)}>
              {t("github.copyCode")}
            </Button>
            <Button size="sm" onClick={() => store.openLink(device.url)}>
              {t("github.openGithub")}
            </Button>
            <ActionButton variant="ghost" size="sm" onClick={cancel}>
              {t("github.cancel")}
            </ActionButton>
          </div>
          <p role="status" className="text-muted-foreground text-xs">
            {t("github.waiting")}
          </p>
        </>
      )}
    </Panel>
  );
}
