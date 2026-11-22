import type { TeamInfo } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { refusalText } from "../../i18n/errors.ts";
import type { AppStore, HostResult } from "../../lib/app-store.ts";
import type { TeamConfirm } from "./domain/new-team.ts";

/** Where the focus goes once an action's answer is on screen, as the control pressed may be gone (#2650). */
type AfterFocus =
  | "pause"
  | "resume"
  | "row"
  | "add"
  | { gone: string; next: string | null }
  /** A member's row, or its Change persona button when `control` is set (#4020). */
  | { member: string; control?: "persona" };

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
  const memberRow = (name: string | null) =>
    Array.from(row.querySelectorAll<HTMLElement>("[data-member]")).find(
      (el) => el.dataset.member === name,
    );
  if ("member" in focus) {
    const member = memberRow(focus.member);
    return focus.control
      ? (member?.querySelector<HTMLElement>(`[data-action="persona"]`) ?? null)
      : (member ?? null);
  }
  // A removed worker's row is gone once the host's answer is in the list.
  if (team.members.some((m) => m.name === focus.gone)) return null;
  return memberRow(focus.next) ?? control("add");
}

/** What a team card does with the host: the commands, what came of the last one, and where the focus goes. */
export function useTeamActions(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    team: TeamInfo;
    onChanged(team: TeamInfo): void;
    onDeleted(text: string): void;
  }>,
) {
  const { store, hostId, team } = props;
  const { t } = store.i18n;
  /** The card's row: the focus goes back inside it. */
  const rowRef = useRef<HTMLLIElement>(null);
  const [text, setText] = useState("");
  /** What the last action did, or why the host refused it: a polite line, not silence (#2650). */
  const [notice, setNotice] = useState<{ text: string; refused: boolean } | null>(null);
  const [focus, setFocus] = useState<AfterFocus | null>(null);
  /** The worker whose removal the host is working on: its Remove button waits (#4020). */
  const [removing, setRemoving] = useState<string | null>(null);
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
    done: { text: string; focus?: AfterFocus; gone?: boolean; retry?: AfterFocus },
  ) => {
    setNotice(null);
    const result = await command;
    if (!result.ok) {
      const reason = refusalText(result.code, result.message, t, result);
      setNotice({ text: t("teamsUi.refused", { reason }), refused: true });
      // A busy button lost the focus: a refusal gives it back, ready for another try.
      if (done.retry) setFocus(done.retry);
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
      // A newer request that came in meanwhile is not ours to clear.
      setFocus((now) => (now === focus ? null : now));
    }, 0);
    return () => clearTimeout(timer);
  }, [focus, team]);
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
    setRemoving(c.member);
    return act(
      store.hostRequest(hostId, "teams.update", { team: team.id, removeMember: c.member }),
      {
        text: t("teamsUi.done.removed", { name: c.label ?? c.member }),
        focus: { gone: c.member, next },
      },
    ).finally(() => setRemoving(null));
  };
  return { rowRef, text, setText, notice, removing, act, sendAll, runConfirmed };
}
