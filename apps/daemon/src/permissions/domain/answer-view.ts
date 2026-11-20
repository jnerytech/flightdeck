/**
 * Issue #3425: what `flightdeckd approve|deny` sends, prints and says when the daemon refuses. Pure:
 * the command asks the daemon, this decides the words.
 */

export interface Answer {
  decision: "allow" | "deny";
  request: string;
  message?: string;
  hold?: boolean;
}

/** The `permission.respond` payload: `held` goes only with an allow, and only when the person gave `--hold`. */
export function answerPayload(answer: Answer) {
  return {
    requestId: answer.request,
    decision: answer.decision,
    ...(answer.message === undefined ? {} : { message: answer.message }),
    ...(answer.decision === "allow" && answer.hold ? { held: true } : {}),
  };
}

/** What a script reads after the daemon took the answer: what was sent, in small words. */
export function answerJson(answer: Answer) {
  const { requestId, ...rest } = answerPayload(answer);
  return { id: requestId, ...rest };
}

export const answerLine = (answer: Answer): string =>
  `${answer.decision === "allow" ? "allowed" : "denied"} ${answer.request}`;

/** The line for a refusal this command knows; null for any other, which prints as the daemon said it. */
export function refusalLine(
  refusal: { reason?: string; detail: string },
  answer: Answer,
): string | null {
  if (refusal.reason === "permission_request_closed")
    return `no such request: ${answer.request} (it is answered already, or it never was open): list the open ones with flightdeckd requests`;
  if (refusal.reason === "hold_required")
    return `${refusal.detail}. A high-risk request is for the person to allow: ask them. --hold is only for a person who read the request and means to allow it, and the daemon does not check it`;
  return null;
}
