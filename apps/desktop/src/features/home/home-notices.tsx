import { Button } from "@/components/ui/button";
import { ScopeMenu } from "@/features/shell/ui.ts";
import type { T } from "@/i18n/index";
import { InlineNotice } from "@/shared/feedback/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { ALL_SCOPE, awayKey, type DataScope } from "../costs/index.ts";

/** The scope menu, when there is more than one host or a project to choose from. */
export function HomeScopeMenu(
  props: Readonly<{
    store: AppStore;
    hosts: HostView[];
    loaded: boolean;
    projects: Array<{ key: string; label: string }>;
    scope: DataScope;
  }>,
) {
  if (!props.loaded || (props.hosts.length <= 1 && props.projects.length === 0)) return null;
  return (
    <ScopeMenu
      store={props.store}
      hosts={props.hosts}
      projects={props.projects}
      scope={props.scope}
    />
  );
}

/** The scoped host is away: without numbers the line above says it; with older numbers, this one. */
export function AwayNotice(
  props: Readonly<{ store: AppStore; away: HostView | undefined; withNumbers: boolean }>,
) {
  const { store, away } = props;
  const { t } = store.i18n;
  if (!away) return null;
  return (
    <InlineNotice tone="info">
      {props.withNumbers && <span>{t(awayKey(away.status, "numbers"), { host: away.name })} </span>}
      <Button variant="outline" size="sm" onClick={() => store.dataScope.set(ALL_SCOPE)}>
        {t("scope.showAll")}
      </Button>
    </InlineNotice>
  );
}

/** What is not whole about the numbers on screen: old ones, missing ones, an older host. */
export function ReadNotices(
  props: Readonly<{
    t: T;
    stale: HostView[];
    silent: HostView[];
    ago: string;
    olderDaemon: boolean;
  }>,
) {
  const { t, stale, silent, ago } = props;
  return (
    <>
      {stale.length > 0 && (
        <InlineNotice tone="info">
          {t("home.stale", { hosts: stale.map((h) => h.name).join(", "), ago })}
        </InlineNotice>
      )}
      {silent.length > 0 && (
        <InlineNotice>
          {t("home.partial", { hosts: silent.map((h) => h.name).join(", ") })}
        </InlineNotice>
      )}
      {props.olderDaemon && <InlineNotice tone="info">{t("home.olderDaemon")}</InlineNotice>}
    </>
  );
}
