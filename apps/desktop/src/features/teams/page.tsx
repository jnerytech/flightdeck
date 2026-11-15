import { UsersRound } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSwitcherHostId } from "@/features/hosts/index.ts";
import { useStoreSlice } from "@/lib/use-store";
import { InlineNotice } from "@/shared/feedback/index.ts";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NativeSelect,
  OpenedPanel,
  Page,
} from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hostsWith } from "../../lib/version.ts";
import { NewTeam } from "./new-team-form.tsx";
import { Team } from "./team-card.tsx";
import { useTeamsList } from "./use-teams-list.ts";

const TEAMSPAGE_KEYS = ["hosts"] as const;

/** Phase 21: the teams of a host, a new one, and the controls of each. */
export const TeamsPage = memo(function TeamsPage(props: {
  store: AppStore;
  /** An alert opens the host and the team it is about; the team is listed first. */
  host?: string;
  team?: string;
  go(route: Route): void;
}) {
  const { store } = props;
  const state = useStoreSlice(store, TEAMSPAGE_KEYS);
  const { t } = store.i18n;
  const hosts = hostsWith(state.hosts, "teams");
  // The host shown: the route's (an alert), else a pick in the page's own select, else the
  // switcher's (#932), so the page never shows another host than the top bar without saying so.
  const switcherId = useSwitcherHostId(store) ?? "";
  /** A host picked in the page's own select: it holds until the next switch or alert. */
  const [picked, setPicked] = useState("");
  const lastSwitcher = useRef(switcherId);
  useEffect(() => {
    if (lastSwitcher.current === switcherId) return;
    lastSwitcher.current = switcherId;
    setPicked("");
  }, [switcherId]);
  // A later alert opens another host while the screen is already up.
  useEffect(() => {
    if (props.host) setPicked("");
  }, [props.host]);
  const wanted = picked || props.host || switcherId;
  const host = hosts.find((h) => h.id === wanted) ?? hosts[0];
  /** The host asked for when it has no teams to show: the page names it and the one shown. */
  const missed = host && wanted !== host.id ? state.hosts.find((h) => h.id === wanted) : undefined;
  const current = host?.id ?? "";
  const { teams, loadFailed, loading, statuses, load } = useTeamsList(store, current);
  const [creating, setCreating] = useState(false);
  /** What a deleted team's row can no longer say, and the button the focus moves to (#2650). */
  const [deleted, setDeleted] = useState<string | null>(null);
  const newTeamRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another host starts with no word of the last one's deletion
  useEffect(() => setDeleted(null), [current]);

  if (!host) {
    return (
      <Page title={t("teamsUi.title")}>
        <EmptyState
          icon={UsersRound}
          title={t("teamsUi.noHost")}
          action={
            <Button variant="link" onClick={() => store.router.push({ name: "add-host" })}>
              {t("teamsUi.noHostLink")}
            </Button>
          }
        />
      </Page>
    );
  }
  return (
    <Page
      title={t("teamsUi.title")}
      subtitle={t("teamsUi.subtitle")}
      actions={
        <div className="flex gap-2">
          {hosts.length > 1 && (
            <NativeSelect
              inline
              aria-label={t("teamsUi.host")}
              value={current}
              onChange={(e) => setPicked(e.target.value)}
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </NativeSelect>
          )}
          {!creating && (
            <Button ref={newTeamRef} data-opener="new-team" onClick={() => setCreating(true)}>
              {t("teamsUi.new")}
            </Button>
          )}
        </div>
      }
    >
      {missed && (
        <InlineNotice tone="info">
          {t(missed.status === "online" ? "teamsUi.otherHost" : "teamsUi.otherHostOffline", {
            wanted: missed.name,
            shown: host.name,
          })}
        </InlineNotice>
      )}
      {deleted && <InlineNotice tone="info">{deleted}</InlineNotice>}
      {creating && (
        <OpenedPanel opener="new-team">
          <NewTeam
            store={store}
            hostId={current}
            onCreated={() => {
              setCreating(false);
              void load();
            }}
            onCancel={() => setCreating(false)}
            onOpenSettings={() => props.go({ name: "settings", section: "assistant" })}
          />
        </OpenedPanel>
      )}
      {loading && !creating && <LoadingState label={t("teamsUi.loading")} />}
      {!loading && loadFailed && teams === null && !creating && (
        <ErrorState
          message={t("teamsUi.loadFailed")}
          retryLabel={t("teamsUi.retry")}
          onRetry={() => void load()}
        />
      )}
      {teams?.length === 0 && !creating && (
        <EmptyState
          icon={UsersRound}
          title={t("teamsUi.empty")}
          action={<Button onClick={() => setCreating(true)}>{t("teamsUi.emptyAction")}</Button>}
        />
      )}
      <ul aria-label={t("teamsUi.list")} className="flex max-w-3xl flex-col gap-3">
        {[...(teams ?? [])]
          .sort((a, b) => Number(b.id === props.team) - Number(a.id === props.team))
          .map((team) => (
            <Team
              key={team.id}
              store={store}
              hostId={current}
              team={team}
              status={statuses[team.id] ?? null}
              focused={team.id === props.team}
              onChanged={() => void load()}
              onDeleted={(text) => {
                setDeleted(text);
                // After the dialog and the menu have given their focus back.
                setTimeout(() => newTeamRef.current?.focus(), 0);
              }}
            />
          ))}
      </ul>
    </Page>
  );
});
