import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { PermissionChoice } from "@/features/personas/index.ts";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { Form, FormActions } from "@/shared/layout/index.ts";
import { refusalText } from "../../i18n/errors.ts";
import type { AppStore, HostResult } from "../../lib/app-store.ts";
import {
  confirmCopy,
  type EffortChoice,
  memberPayload,
  type TeamConfirm,
} from "./domain/new-team.ts";
import { NewMember } from "./new-member.tsx";
import { TeamMemberRow } from "./team-member-row.tsx";
import { TeamOutcome } from "./team-outcome.tsx";
import { useModes } from "./use-modes.ts";

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
export function Team(
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
