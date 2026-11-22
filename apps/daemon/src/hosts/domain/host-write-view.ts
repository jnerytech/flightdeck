/** Issue #3699: what `flightdeckd host sleep|keep-awake|pause|updates|bypass` print, as pure functions of the daemon's answer. */
import type { AutoUpdateStatus, HostPauseStatus, KeepAwakeStatus } from "@flightdeck/protocol";

/** ` (text)` when there is text, else nothing. */
const inParens = (text: string | null | undefined): string => (text ? ` (${text})` : "");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const sleepLine = (minutes: number): string =>
  minutes === 0 ? "sleep  off" : `sleep  idle sessions sleep after ${plural(minutes, "minute")}`;

export function keepAwakeLine(status: KeepAwakeStatus): string {
  if (!status.enabled) return "keep-awake  off";
  if (status.held) return `keep-awake  on  held${inParens(status.method)}`;
  return `keep-awake  on  not held${inParens(status.reason)}`;
}

export function pauseLine(status: HostPauseStatus): string {
  if (!status.paused) return "pause  off";
  return status.running > 0
    ? `pause  on  (${plural(status.running, "session")} still running)`
    : "pause  on";
}

export function updatesLine(status: AutoUpdateStatus): string {
  if (!status.enabled) return "updates  automatic off";
  const detail = status.reason ? `${status.state}: ${status.reason}` : status.state;
  return `updates  automatic on  (${detail})`;
}

export const bypassLine = (allowed: boolean): string =>
  `bypass permissions  ${allowed ? "allowed" : "not allowed"}`;

/** What the person is told when a host with a device enrolled wants the device's signature, which a terminal cannot give (#3453). */
export const BYPASS_NEEDS_APP =
  "this host has a device enrolled, which confirms allowing sessions without permission prompts: turn it on in the app";

export const UNSURE_HOST =
  "; the setting may or may not have changed: the command is safe to run again";
