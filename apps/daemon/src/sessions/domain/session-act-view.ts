/**
 * Issue #3514: what the verbs of `flightdeckd session` that act print. Pure: the command asks the
 * daemon, this words the result.
 */

/** What `session.sleep` answers: the session slept, was asleep already, or why it did not sleep. */
export type SleepResult = "slept" | "already" | "not_idle" | "queued" | "kept_awake" | "subscribed";

const NOT_ASLEEP: Record<string, string> = {
  not_idle: "it is not idle",
  queued: "a message waits for it",
  kept_awake: "something keeps it awake",
  subscribed: "someone is watching it",
};

/** The reason a session was not put to sleep, or undefined when it is asleep. */
export const sleepRefusal = (session: string, result: SleepResult): string | undefined =>
  result in NOT_ASLEEP ? `${session} was not put to sleep: ${NOT_ASLEEP[result]}` : undefined;

export const sleepLine = (session: string, result: SleepResult): string =>
  result === "already" ? `${session} was already asleep` : `${session} is asleep`;

export const modelLine = (session: string, model: string | null): string =>
  model === null ? `${session} uses the default model` : `${session} uses the model ${model}`;

export const effortLine = (session: string, effort: string | null): string =>
  effort === null
    ? `${session} works at the default effort`
    : `${session} works at the effort ${effort}`;

/** `s1 updated: name Review, pinned true`; a name that was cleared reads `name cleared`. */
export const metaLine = (
  session: string,
  fields: { name?: string | null; pinned?: boolean; archived?: boolean },
): string => {
  const parts: string[] = [];
  if (fields.name !== undefined)
    parts.push(fields.name === null ? "name cleared" : `name ${fields.name}`);
  if (fields.pinned !== undefined) parts.push(`pinned ${fields.pinned}`);
  if (fields.archived !== undefined) parts.push(`archived ${fields.archived}`);
  return `${session} updated: ${parts.join(", ")}`;
};

const DONE: Record<string, string> = {
  interrupt: "interrupted",
  close: "closed",
  resume: "resumed",
};

export const doneLine = (session: string, action: string): string => `${session} ${DONE[action]}`;
