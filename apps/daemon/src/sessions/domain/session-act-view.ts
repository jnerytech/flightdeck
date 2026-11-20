/**
 * Issue #3514: what the verbs of `flightdeckd session` that act print. Pure: the command asks the
 * daemon, this words the result.
 */

const NOT_ASLEEP: Record<string, string> = {
  not_idle: "it is not idle",
  queued: "a message waits for it",
  kept_awake: "something keeps it awake",
  subscribed: "someone is watching it",
};

/** The reason a session was not put to sleep, or undefined when it is asleep: only `slept` and `already` are. */
export const sleepRefusal = (session: string, result: string): string | undefined =>
  result === "slept" || result === "already"
    ? undefined
    : `${session} was not put to sleep: ${Object.hasOwn(NOT_ASLEEP, result) ? NOT_ASLEEP[result] : `the daemon answered ${result}`}`;

export const sleepLine = (session: string, result: string): string =>
  result === "already" ? `${session} was already asleep` : `${session} is asleep`;

export const modelLine = (session: string, model: string | null): string =>
  model === null ? `${session} uses the default model` : `${session} uses the model ${model}`;

export const effortLine = (session: string, effort: string | null): string =>
  effort === null
    ? `${session} works at the default effort`
    : `${session} works at the effort ${effort}`;

/** `s1 updated: name Review, pinned true`, for the fields that were asked, with what the daemon kept; a name cleared reads `name cleared`. */
export const metaLine = (
  session: string,
  asked: string[],
  kept: { name?: string | null; pinned?: boolean; archived?: boolean },
): string => {
  const parts: string[] = [];
  if (asked.includes("name")) parts.push(kept.name == null ? "name cleared" : `name ${kept.name}`);
  if (asked.includes("pinned")) parts.push(`pinned ${kept.pinned}`);
  if (asked.includes("archived")) parts.push(`archived ${kept.archived}`);
  return `${session} updated: ${parts.join(", ")}`;
};

const DONE: Record<string, string> = {
  interrupt: "interrupted",
  close: "closed",
  resume: "resumed",
};

export const doneLine = (session: string, action: string): string => `${session} ${DONE[action]}`;
