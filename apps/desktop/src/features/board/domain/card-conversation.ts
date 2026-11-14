/**
 * The conversation of a card is on show: its tab is open, no check output is opened, and a session
 * is there to show (the opened step's, or the card's own).
 */
export function conversationShown(input: {
  tab: string;
  openedStep: { type: string } | undefined;
  stepSession: object | null;
  session: object | null;
  sessionId: string | null;
}): boolean {
  const { tab, openedStep, stepSession, session, sessionId } = input;
  if (tab !== "conversation" || openedStep?.type === "check") return false;
  return Boolean((openedStep && stepSession) || (session && sessionId));
}
