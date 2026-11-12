import { describe, expect, test } from "bun:test";
import { sessionTabOffers } from "../../src/features/sessions/tab-offers.ts";
import type { HostView } from "../../src/lib/app-store.ts";

const host = (features?: string[]) =>
  ({ hostInfo: features ? { features } : undefined }) as HostView;
const all = ["review", "messaging", "telemetry", "trace", "file.list", "terminal.session"];

describe("sessionTabOffers", () => {
  test("a host that announces every feature offers every tab, with a shell when embedded", () => {
    expect(sessionTabOffers(host(all), false, "s1", true)).toEqual({
      terminal: { session: "s1" },
      enabled: true,
      messagingId: "s1",
      telemetry: true,
      trace: true,
      files: true,
    });
  });

  test("no shell tab unless the terminal is embedded and the host opens one for a session", () => {
    expect("terminal" in sessionTabOffers(host(all), false, "s1", false)).toBe(false);
    expect("terminal" in sessionTabOffers(host(["review"]), false, "s1", true)).toBe(false);
  });

  test("an OpenCode session keeps out of the tabs that read Claude Code's transcript", () => {
    expect(sessionTabOffers(host(all), true, "s1", false)).toEqual({
      enabled: false,
      messagingId: null,
      telemetry: false,
      trace: false,
      files: false,
    });
  });

  test("a host that announces nothing, or no host, offers none of them", () => {
    expect(sessionTabOffers(host([]), false, "s1", false)).toMatchObject({
      enabled: false,
      files: false,
    });
    expect(sessionTabOffers(host(), false, "s1", false)).toMatchObject({
      enabled: false,
      files: false,
    });
    expect(sessionTabOffers(undefined, false, "s1", false)).toMatchObject({ messagingId: null });
  });
});
