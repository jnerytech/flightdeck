import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
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
import type { AppStore } from "../../lib/app-store.ts";
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
import { useTeamActions } from "./use-team-actions.ts";

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
  const { rowRef, text, setText, notice, act, sendAll, runConfirmed } = useTeamActions({
    store,
    hostId,
    team,
    onChanged: props.onChanged,
    onDeleted: props.onDeleted,
  });
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
  const copy = confirm ? confirmCopy(confirm, team.name, t) : null;
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
