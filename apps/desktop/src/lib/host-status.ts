import type { Key, T } from "../i18n/index.ts";
import type { HostView } from "./app-store.ts";
import type { ConnectionStatus } from "./host-connection.ts";

/** What a host's connection looks like: its text and the family of its color. */
export type HostTone = "online" | "reconnecting" | "offline" | "refused" | "incompatible";

const TONES: Record<ConnectionStatus, HostTone> = {
  online: "online",
  offline: "offline",
  connecting: "reconnecting",
  unauthorized: "refused",
  incompatible: "incompatible",
};

export function hostStatusView(status: ConnectionStatus, t: T): { label: string; tone: HostTone } {
  return { label: t(`hosts.status.${status}` as Key), tone: TONES[status] };
}

/** The hosts that are not online, split: those down, and those being reached again. */
export function hostsBanner(hosts: HostView[]): {
  down: HostView[];
  reconnecting: HostView[];
} {
  return {
    down: hosts.filter((h) => h.status !== "online" && h.status !== "connecting"),
    reconnecting: hosts.filter((h) => h.status === "connecting"),
  };
}
