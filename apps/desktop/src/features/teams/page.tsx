import type { TeamInfo, TeamMember, TeamStatus } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { Copy, MoreHorizontal, UsersRound } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSwitcherHostId } from "@/features/hosts/index.ts";
import type { PermissionChoice } from "@/features/personas/index.ts";
import { PersonaPicker } from "@/features/personas/ui.ts";
import { sessionLabel, useDraft } from "@/features/sessions/index.ts";
import { useStoreSlice } from "@/lib/use-store";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import {
  EmptyState,
  ErrorState,
  FieldRow,
  Form,
  FormActions,
  LoadingState,
  NativeSelect,
  Page,
} from "@/shared/layout/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import type { AppStore, HostResult } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hostsWith } from "../../lib/version.ts";
import { NewMember } from "./new-member.tsx";
import { confirmCopy, type EffortChoice, memberPayload, type TeamConfirm } from "./new-team.ts";
import { NewTeam } from "./new-team-form.tsx";
import { TeamOutcome } from "./team-outcome.tsx";
import { useModes } from "./use-modes.ts";

/** What a member's row reads: the names and personas of its host (issue #101). */
const MEMBER_KEYS = ["names", "personas", "cards"] as const;

/** #1220: how many files a worker's card changed, asked of its host once the row shows. */
function useChangedFiles(store: AppStore, hostId: string, cardId: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    // Another card's number never shows while this one's is asked.
    setCount(null);
    if (!cardId) return;
    let live = true;
    void store.hostRequest(hostId, "changes.get", { target: `card:${cardId}` }).then((result) => {
      if (live && result.ok) setCount(result.data.files.length);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, cardId]);
  return count;
}

/** One member: its role, persona, state, card and last report, and the persona to switch to. */
export function TeamMemberRow(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    member: TeamMember;
    report: { text: string; at: string } | null;
    open: boolean;
    /** True once the host took it. */
    onPersona(persona: string, label: string): Promise<boolean>;
    onRemove(label: string): void;
  }>,
) {
  const { store, member } = props;
  const { t } = store.i18n;
  const { names, personas, cards } = useStoreSlice(store, MEMBER_KEYS);
  const branch = member.cardId ? (cards[`${props.hostId}/${member.cardId}`]?.branch ?? null) : null;
  const changed = useChangedFiles(
    store,
    props.hostId,
    member.role === "worker" ? member.cardId : null,
  );
  const [persona, setPersona, savedPersona] = useDraft(member.persona ?? "");
  const listed = personas[props.hostId];
  // Issue #101: the member's name in the person's language, by its persona, as everywhere else.
  const label =
    sessionLabel(
      {
        names: names[props.hostId]?.find((name) => name.sessionId === member.sessionId),
        createdName: member.name,
        personas: listed,
      },
      t,
    ) ?? member.name;
  const sessionId = member.sessionId;
  const openSession = () =>
    store.router.push({ name: "session", host: props.hostId, id: sessionId ?? "" });
  return (
    <li
      data-slot="team-member"
      data-member={member.name}
      tabIndex={-1}
      className="stack-tight rounded-md border p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div data-slot="member-head" className="member-head">
        <div className="member-id">
          {sessionId ? (
            <Button variant="link" size="sm" onClick={openSession}>
              {label}
            </Button>
          ) : (
            <strong>{label}</strong>
          )}
          <Badge variant="outline">
            {t(member.role === "coordinator" ? "teamsUi.coordinator" : "teamsUi.worker")}
          </Badge>
          {member.persona && (
            <Badge variant="outline">
              {listed?.find((p) => p.id === member.persona)?.name ?? member.persona}
            </Badge>
          )}
          {member.model && <Badge variant="outline">{member.model}</Badge>}
        </div>
        <div data-slot="member-end" className="member-end">
          {member.sessionState && (
            <span className="text-muted-foreground">
              {t(`teamsUi.sessionStates.${member.sessionState}`)}
            </span>
          )}
          {sessionId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("teamsUi.copyId", { name: label })}
                  onClick={() => {
                    void store.system.copyText(sessionId);
                    store.success(t("teamsUi.idCopied"));
                  }}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sessionId}</TooltipContent>
            </Tooltip>
          )}
          {sessionId && (
            <Button
              variant="link"
              size="sm"
              aria-label={t("teamsUi.openSessionOf", { name: label })}
              onClick={openSession}
            >
              {t("teamsUi.openSession")}
            </Button>
          )}
          {member.cardId && (
            <Button
              variant="link"
              size="sm"
              aria-label={t("teamsUi.openCardOf", { name: label })}
              onClick={() =>
                store.router.push({
                  name: "card",
                  host: props.hostId,
                  projectId: props.projectId,
                  cardId: member.cardId ?? "",
                })
              }
            >
              {t("teamsUi.openCard")}
            </Button>
          )}
        </div>
      </div>
      {props.report && (
        <p className="text-muted-foreground">
          {t("teamsUi.lastReport")}: {props.report.text}
        </p>
      )}
      {(branch || changed !== null) && (
        <p className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
          {branch && <span>{t("teamsUi.branch", { branch })}</span>}
          {branch && changed !== null && " · "}
          {changed !== null && (
            <span>
              {changed === 1 ? t("teamsUi.changedOne") : t("teamsUi.changedMany", { n: changed })}
            </span>
          )}
        </p>
      )}
      {props.open && (
        <FieldRow align="end" slot="member-persona">
          <div data-slot="persona-field" className="persona-field">
            <PersonaPicker
              store={store}
              hostId={props.hostId}
              label={t("teamsUi.persona", { name: label })}
              value={persona}
              onChange={setPersona}
              idsOnly
            />
          </div>
          <Button
            variant="outline"
            aria-label={t("teamsUi.setPersona", { name: label })}
            onClick={async () => {
              const sent = persona;
              if (await props.onPersona(sent, label)) savedPersona(sent);
            }}
          >
            {t("teamsUi.setPersonaButton")}
          </Button>
          {member.role === "worker" && (
            <Button
              variant="outline"
              aria-label={t("teamsUi.remove", { name: label })}
              onClick={() => props.onRemove(label)}
            >
              {t("teamsUi.removeButton")}
            </Button>
          )}
        </FieldRow>
      )}
    </li>
  );
}

/** Where the focus goes once an action's answer is on screen, as the control pressed may be gone (#2650). */
type AfterFocus = "pause" | "resume" | "row" | "add" | { gone: string; next: string | null };

/** The element the focus goes to, or null while the answer has not reached the row yet. */
function focusTarget(
  row: HTMLElement | null,
  focus: AfterFocus,
  team: TeamInfo,
): HTMLElement | null {
  if (!row) return null;
  const control = (action: string) => row.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (focus === "row") return row;
  if (typeof focus === "string") return control(focus);
  // A removed worker's row is gone once the host's answer is in the list.
  if (team.members.some((m) => m.name === focus.gone)) return null;
  const next = Array.from(row.querySelectorAll<HTMLElement>("[data-member]")).find(
    (el) => el.dataset.member === focus.next,
  );
  return next ?? control("add");
}

/** One team with its members and its controls. */
function Team(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    team: TeamInfo;
    status: TeamStatus | null;
    /** The team an alert opened. */
    focused: boolean;
    onChanged(team: TeamInfo): void;
    /** The team is gone from the list: the page says so, as this row goes with it. */
    onDeleted(text: string): void;
  }>,
) {
  const { store, hostId, team } = props;
  const { t } = store.i18n;
  const [text, setText] = useState("");
  /** What the last action did, or why the host refused it: a polite line, not silence (#2650). */
  const [notice, setNotice] = useState<{ text: string; refused: boolean } | null>(null);
  const [focus, setFocus] = useState<AfterFocus | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const [adding, setAdding] = useState(false);
  /** A worker set to Bypass waits here for the person's yes. */
  const [bypassing, setBypassing] = useState<{
    persona: string;
    model: string;
    effort: EffortChoice;
    permission: PermissionChoice;
  } | null>(null);
  const modes = useModes(store, hostId);
  const [confirm, setConfirm] = useState<TeamConfirm | null>(null);
  const open = team.state !== "closed";
  const addMember = (member: {
    persona: string;
    model: string;
    effort: EffortChoice;
    permission: PermissionChoice;
  }) => {
    setAdding(false);
    setBypassing(null);
    void act(
      store.hostRequest(hostId, "teams.update", {
        team: team.id,
        addMember: memberPayload(member),
      }),
      { text: t("teamsUi.done.added", { name: team.name }), focus: "add" },
    );
  };
  /** A text a worker took is sent; one every worker refused stays, to be sent again. */
  const sending = useRef(false);
  const sendAll = async () => {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    try {
      const result = await store.hostCommand(hostId, "teams.message", { team: team.id, text });
      if (!result) return;
      setNotice({ text: t("teamsUi.sentAll", result), refused: result.delivered === 0 });
      if (result.delivered >= 1) setText("");
    } finally {
      sending.current = false;
    }
  };
  /** Runs a team command and says what came of it; `focus` is where the focus goes after it. */
  const act = async (
    command: Promise<HostResult<TeamInfo>>,
    done: { text: string; focus?: AfterFocus; gone?: boolean },
  ) => {
    setNotice(null);
    const result = await command;
    if (!result.ok) {
      const reason = refusalText(result.code, result.message, t, result);
      setNotice({ text: t("teamsUi.refused", { reason }), refused: true });
      return false;
    }
    props.onChanged(result.data);
    if (done.gone) props.onDeleted(done.text);
    else setNotice({ text: done.text, refused: false });
    if (done.focus) setFocus(done.focus);
    return true;
  };
  // The closing dialog hands the focus back in a timeout of its own: this one comes after it.
  useEffect(() => {
    if (!focus) return;
    const target = focusTarget(rowRef.current, focus, team);
    if (!target) return;
    const timer = setTimeout(() => {
      target.focus();
      setFocus(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [focus, team]);
  const copy = confirm ? confirmCopy(confirm, team.name, t) : null;
  const runConfirmed = (c: TeamConfirm) => {
    const name = { name: team.name };
    if (c.kind === "close") {
      return act(store.hostRequest(hostId, "teams.close", { team: team.id, confirm: true }), {
        text: t("teamsUi.done.closed", name),
        focus: "row",
      });
    }
    if (c.kind === "delete") {
      return act(store.hostRequest(hostId, "teams.delete", { team: team.id }), {
        text: t("teamsUi.done.deleted", name),
        gone: true,
      });
    }
    const workers = team.members.filter((m) => m.role === "worker");
    const next = workers[workers.findIndex((m) => m.name === c.member) + 1]?.name ?? null;
    return act(
      store.hostRequest(hostId, "teams.update", { team: team.id, removeMember: c.member }),
      {
        text: t("teamsUi.done.removed", { name: c.label ?? c.member }),
        focus: { gone: c.member, next },
      },
    );
  };
  const reportOf = (name: string) =>
    props.status?.members.find((m) => m.name === name)?.lastReport ?? null;
  const rowClass = `flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring${props.focused ? " ring-2 ring-ring" : ""}`;
  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      aria-label={t("teamsUi.row", { name: team.name })}
      {...(props.focused ? { "aria-current": "true" as const } : {})}
      className={rowClass}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>{team.name}</strong>
        <Badge variant="outline">{t(`teamsUi.states.${team.state}`)}</Badge>
        {team.pausedBy === "quota" && (
          <span className="text-status-needs-you text-xs">{t("teamsUi.pausedByQuota")}</span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("teamsUi.menu", { name: team.name })}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Only a closed team can be deleted; an open one says what to do first. */}
            <DropdownMenuItem disabled={open} onSelect={() => setConfirm({ kind: "delete" })}>
              {open ? `${t("teamsUi.delete")} · ${t("teamsUi.deleteOpen")}` : t("teamsUi.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {props.status?.outcome && <TeamOutcome t={t} outcome={props.status.outcome} />}
      <p className="text-muted-foreground whitespace-pre-wrap">{team.goal}</p>
      <ul className="flex flex-col gap-1">
        {team.members.map((member) => (
          <TeamMemberRow
            key={member.name}
            store={store}
            hostId={hostId}
            projectId={team.projectId}
            member={member}
            report={reportOf(member.name)}
            open={open}
            onPersona={(persona, label) =>
              act(
                store.hostRequest(hostId, "teams.update", {
                  team: team.id,
                  persona: { member: member.name, persona: persona.trim() || null },
                }),
                { text: t("teamsUi.done.persona", { name: label }) },
              )
            }
            onRemove={(label) => setConfirm({ kind: "remove", member: member.name, label })}
          />
        ))}
      </ul>
      {open && (
        <div data-slot="team-footer" className="team-footer">
          <div className="team-row">
            {team.state === "active" ? (
              <Button
                variant="outline"
                size="sm"
                data-action="pause"
                aria-label={t("teamsUi.pause", { name: team.name })}
                onClick={() =>
                  void act(store.hostRequest(hostId, "teams.pause", { team: team.id }), {
                    text: t("teamsUi.done.paused", { name: team.name }),
                    focus: "resume",
                  })
                }
              >
                {t("teamsUi.pauseButton")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                data-action="resume"
                aria-label={t("teamsUi.resume", { name: team.name })}
                onClick={() =>
                  void act(store.hostRequest(hostId, "teams.resume", { team: team.id }), {
                    text: t("teamsUi.done.resumed", { name: team.name }),
                    focus: "pause",
                  })
                }
              >
                {t("teamsUi.resumeButton")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              data-action="add"
              aria-label={t("teamsUi.addWorker", { name: team.name })}
              onClick={() => setAdding(true)}
            >
              {t("teamsUi.addWorkerButton")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={t("teamsUi.close", { name: team.name })}
              onClick={() => setConfirm({ kind: "close" })}
            >
              {t("teamsUi.closeButton")}
            </Button>
          </div>
          {adding && (
            <NewMember
              store={store}
              hostId={hostId}
              team={team}
              onCancel={() => setAdding(false)}
              onAdd={(member) => {
                if (member.permission === "bypassPermissions") {
                  setBypassing(member);
                  return;
                }
                addMember(member);
              }}
            />
          )}
          <Form variant="inline" onSubmit={() => void sendAll()}>
            <Input
              aria-label={t("teamsUi.messageAll")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-8"
            />
            <FormActions submit={t("teamsUi.sendAll")} disabled={!text.trim()} />
          </Form>
        </div>
      )}
      {notice && (
        <InlineNotice tone={notice.refused ? "error" : "info"}>{notice.text}</InlineNotice>
      )}
      {bypassing && (
        <ConfirmDialog
          message={t("teamsUi.bypassMessage", { host: modes.name })}
          confirmLabel={t("teamsUi.bypassAddConfirm")}
          destructive
          onConfirm={() => addMember(bypassing)}
          onCancel={() => setBypassing(null)}
        />
      )}
      {confirm && copy && (
        <ConfirmDialog
          message={copy.message}
          confirmLabel={copy.label}
          destructive
          onConfirm={() => {
            setConfirm(null);
            void runConfirmed(confirm);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </li>
  );
}

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
  /** `null` until `teams.list` answers: an empty list is an answer, not the absence of one (#2647). */
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loading = useMinLoading(teams === null && !loadFailed);
  const [statuses, setStatuses] = useState<Record<string, TeamStatus>>({});
  const [creating, setCreating] = useState(false);
  /** What a deleted team's row can no longer say, and the button the focus moves to (#2650). */
  const [deleted, setDeleted] = useState<string | null>(null);
  const newTeamRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another host starts with no word of the last one's deletion
  useEffect(() => setDeleted(null), [current]);

  const load = useCallback(async () => {
    if (!current) return;
    // A retry shows the loading shape again, so the person sees it was taken.
    setLoadFailed(false);
    // The page has its own retry, so the toast offers none that would throw the answer away.
    const list = await store.hostCommand(current, "teams.list", {}, { retry: false });
    // `hostCommand` raises the toast with the reason and answers null for a refused request.
    setLoadFailed(!list);
    if (!list) return;
    setTeams(list.teams);
    // The workers' branches are on their cards: the page asks for its teams' boards, as the app
    // may open here first (#1220), without holding the teams' states back.
    void inSequence([...new Set(list.teams.map((team) => team.projectId))], (projectId) =>
      store.boardCards.load(current, projectId),
    );
    const next: Record<string, TeamStatus> = {};
    await inSequence(list.teams, async (team) => {
      const status = await store.hostCommand(current, "teams.status", { team: team.id });
      if (status) next[team.id] = status;
    });
    setStatuses(next);
  }, [store, current]);
  useEffect(() => {
    if (current) void store.projectList.load(current);
    void load();
    return store.teams.onUpdated(() => void load());
  }, [store, current, load]);

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
            <Button ref={newTeamRef} onClick={() => setCreating(true)}>
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
