import type { GithubLoginResult, GithubStatusResult } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { ErrorState, LoadingState, Panel } from "@/shared/layout/index.ts";

/**
 * The host's GitHub sign-in (phase 37): the host's gh does the device flow and keeps the token, so
 * this panel only shows the one-time code and the page, and then who is signed in. No token here.
 */
export function GithubPanel(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const [status, setStatus] = useState<GithubStatusResult | null>(null);
  const [device, setDevice] = useState<GithubLoginResult | null>(null);
  // The host refused the last read (it shows only while there is nothing to show yet).
  const [unread, setUnread] = useState(false);
  // What the host refused of the last action, said in the panel (the banner keeps the host's reason).
  const [refused, setRefused] = useState<"startFailed" | "signOutFailed" | "cancelFailed" | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const next = await store.hostCommand(host.id, "github.status", {});
    if (next) setStatus(next);
    setUnread(next === null);
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
        if (next?.loggedIn) {
          setDevice(null);
          void store.refreshSetup(host.id, { github: true });
        }
      });
    });
  }, [device, refresh, store, host.id]);

  const signIn = async () => {
    setRefused(null);
    const started = await store.hostCommand(host.id, "github.login.start", {});
    if (started) setDevice(started);
    else setRefused("startFailed");
  };
  const cancel = async () => {
    setRefused(null);
    // `hostRequest`: a cancel or a sign-out answers with no data, so only it tells a refusal from a success.
    const answer = await store.hostRequest(host.id, "github.login.cancel", {});
    // A cancel the host refused leaves its login running: the code stays, so it can be cancelled again.
    if (!answer.ok) {
      setRefused("cancelFailed");
      return;
    }
    setDevice(null);
    await refresh();
  };
  const signOut = async () => {
    setRefused(null);
    const answer = await store.hostRequest(host.id, "github.logout", {});
    // Already signed out (elsewhere): the host says so, and reading again shows it.
    if (!answer.ok && answer.reason !== "gh_logged_out") {
      setRefused("signOutFailed");
      return;
    }
    await refresh();
    void store.refreshSetup(host.id, { github: true });
  };

  return (
    <Panel title={t("github.title")}>
      <p className="text-muted-foreground text-xs">{t("github.hint")}</p>
      {status === null && !unread && <LoadingState label={t("github.loading")} />}
      {status === null && unread && (
        <ErrorState
          message={t("github.failed")}
          retryLabel={t("github.recheck")}
          onRetry={() => void refresh()}
        />
      )}
      {refused && <InlineNotice tone="error">{t(`github.${refused}`)}</InlineNotice>}
      {status && !status.installed && (
        <>
          <output className="text-sm">{t("github.notInstalled")}</output>
          <div>
            <ActionButton
              variant="outline"
              size="sm"
              onClick={async () => {
                await refresh();
              }}
            >
              {t("github.recheck")}
            </ActionButton>
          </div>
        </>
      )}
      {status?.installed && status.loggedIn && (
        <>
          <output className="text-sm">{t("github.signedIn", { login: status.login ?? "" })}</output>
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
          <output className="text-sm">{t("github.signedOut")}</output>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void store.system.copyText(device.code)}
            >
              {t("github.copyCode")}
            </Button>
            <Button size="sm" onClick={() => store.openLink(device.url)}>
              {t("github.openGithub")}
            </Button>
            <ActionButton variant="ghost" size="sm" onClick={cancel}>
              {t("github.cancel")}
            </ActionButton>
          </div>
          <output className="text-muted-foreground text-xs">{t("github.waiting")}</output>
          <p className="text-muted-foreground text-xs">{t("github.codeExpires")}</p>
        </>
      )}
    </Panel>
  );
}
