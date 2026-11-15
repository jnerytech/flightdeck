import type { TeamMember } from "@flightdeck/protocol";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PersonaPicker } from "@/features/personas/ui.ts";
import { sessionLabel, useDraft } from "@/features/sessions/index.ts";
import { useStoreSlice } from "@/lib/use-store";
import { FieldRow } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

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
