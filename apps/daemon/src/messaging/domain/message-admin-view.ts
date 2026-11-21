/**
 * Issue #3622: what `flightdeckd message history|watch|rules` say, as pure rules over the daemon's answers.
 * The daemon calls and the exit codes stay in `messaging/message-admin-cli.ts`. A message is text a session
 * wrote: it prints as one plain line, never as markup, and the terminal scrub of the runner does the rest.
 */
import type {
  IdleFiredFrame,
  MessageInfo,
  MessageStatus,
  MessagesRelayFrame,
  MessagesUpdatedFrame,
  MessagingAlertFrame,
} from "@flightdeck/protocol";

/** What `history` asks `messages.list`: the filters the person typed, under the daemon's own names. */
export interface MessageFilters {
  team?: string;
  session?: string;
  /** `--with-host`: the host a message came from or went to (`--host` is the host the command asks). */
  withHost?: string;
  status?: MessageStatus;
  days?: number;
  limit?: number;
}

export interface MessageAdminCliArgs extends MessageFilters {
  action: "history" | "watch" | "rules";
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

/** The payload of `messages.list`: only what was typed, so the daemon's defaults apply to the rest. */
export function listPayload(filters: MessageFilters) {
  return {
    ...(filters.team === undefined ? {} : { team: filters.team }),
    ...(filters.session === undefined ? {} : { session: filters.session }),
    ...(filters.withHost === undefined ? {} : { host: filters.withHost }),
    ...(filters.status === undefined ? {} : { status: filters.status }),
    ...(filters.days === undefined ? {} : { days: filters.days }),
    ...(filters.limit === undefined ? {} : { limit: filters.limit }),
  };
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The line of one message in `history` and in `watch`. */
function messageLine(message: MessageInfo): string {
  const why = message.reason === null ? "" : ` (${oneLine(message.reason)})`;
  return [
    message.id,
    message.createdAt,
    `${message.fromSession}@${message.fromHost} to ${message.toSession}@${message.toHost}`,
    `${message.status}${why}`,
    oneLine(message.text),
  ].join("  ");
}

export function historyLines(messages: readonly MessageInfo[]): string[] {
  return messages.length === 0 ? ["no messages"] : messages.map(messageLine);
}

export function rulesLines(rules: { policy: unknown; paused: readonly string[] }): string[] {
  return [
    `policy: ${JSON.stringify(rules.policy)}`,
    `paused pairs: ${rules.paused.length === 0 ? "none" : rules.paused.join(", ")}`,
  ];
}

export type MessageFrame =
  | MessagesUpdatedFrame
  | MessagesRelayFrame
  | MessagingAlertFrame
  | IdleFiredFrame;

/** The frame types `watch` prints, as `messages.watch` pushes them. */
export const WATCH_FRAMES = [
  "messages.updated",
  "messages.relay",
  "messaging.alert",
  "idle.fired",
] as const;

/** The line `watch` prints for a frame. */
export function frameLine(frame: MessageFrame): string {
  switch (frame.type) {
    case "messages.updated":
      return messageLine(frame.message);
    case "messages.relay": {
      const { id, from, toSession, toHost, text } = frame.message;
      return `relay  ${id}  ${from.id}@${from.host} to ${toSession}@${toHost}  ${oneLine(text)}`;
    }
    case "messaging.alert":
      return `${frame.kind} alert  ${frame.from} to ${frame.to}  ${oneLine(frame.message)}`;
    case "idle.fired":
      return `idle  ${frame.session}  watched by ${frame.watcher}`;
  }
}
