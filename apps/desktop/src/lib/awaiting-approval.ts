/** Issue #1705: what a stored conversation is waiting for the person to answer, if its tail says so. */
import type { HistoryMessage } from "@flightdeck/protocol";
import { messageParts } from "../features/sessions/index.ts";

export type Awaiting = "plan" | "question";

/** The tools that stop a turn until the person answers, and what each one waits for. */
const ASKS: Readonly<Record<string, Awaiting>> = {
  ExitPlanMode: "plan",
  AskUserQuestion: "question",
};

/**
 * The answer a conversation waits for at its tail: its last message is an assistant turn that ends in
 * one of those calls. Anything after it (the person's reply, the model going on) answers it; the
 * transcript has no other say, so the caller also checks that the session is alive.
 */
export function awaitingApproval(messages: readonly HistoryMessage[]): Awaiting | null {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.kind !== "message") return null;
  const end = messageParts(last.text).at(-1);
  return end?.kind === "tool" ? (ASKS[end.name] ?? null) : null;
}
