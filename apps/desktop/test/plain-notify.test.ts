import { describe, expect, test } from "bun:test";
import { type PendingPermission, plainInfo } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { needsYou, type PendingItem } from "../src/lib/app-store.ts";
import { summaryNotifications } from "../src/lib/notify.ts";
import { trayMenu } from "../src/lib/tray.ts";

/**
 * Issue #88: outside the window (the OS notification, the tray) a host in simple mode says what a
 * waiting task asks in the plain sentence, not "Allow Write?".
 */
const en = translator("en");
const ptBR = translator("pt-BR");
const plain = plainInfo({
  toolName: "Write",
  input: { file_path: "/w/Reports/a.md" },
  fileExists: false,
  risk: "low",
});
const base = { status: "running" as const, pendingPermissions: [] as PendingPermission[] };
const asking = (withPlain: boolean) => ({
  status: "awaiting_permission" as const,
  pendingPermissions: [
    {
      requestId: "r1",
      toolName: "Write",
      createdAt: "t",
      ...(withPlain ? { plain } : {}),
    },
  ],
});

describe("plain-notify: the notification of a waiting task", () => {
  test("Given a host in simple mode and a request with its wording, Then the notification says it in the plain sentence", () => {
    expect(
      summaryNotifications(
        base,
        asking(true),
        "pc · Reports",
        false,
        undefined,
        en,
        undefined,
        true,
      ),
    ).toEqual([
      {
        event: "needs-you",
        title: "pc · Reports: waiting for your answer",
        body: "Create the file a.md in Reports",
      },
    ]);
    expect(
      summaryNotifications(
        base,
        asking(true),
        "pc · Reports",
        false,
        undefined,
        ptBR,
        undefined,
        true,
      )[0]?.body,
    ).toBe("Criar o arquivo a.md em Reports");
  });

  test("Given an older daemon that sent no wording, Then simple mode keeps today's text", () => {
    expect(
      summaryNotifications(base, asking(false), "pc · s", false, undefined, en, undefined, true),
    ).toEqual([{ event: "needs-you", title: "pc · s: needs you", body: "Allow Write?" }]);
  });

  test("Given a host in full mode, Then the wording is not used", () => {
    expect(
      summaryNotifications(base, asking(true), "pc · s", false, undefined, en, undefined, false),
    ).toEqual([{ event: "needs-you", title: "pc · s: needs you", body: "Allow Write?" }]);
  });
});

describe("plain-notify: the tray and the list of what waits", () => {
  const item = (patch: Partial<PendingItem> = {}): PendingItem => ({
    hostId: "h1",
    hostName: "alfa",
    sessionId: "s1",
    sessionName: "Reports",
    requestId: "r1",
    toolName: "Write",
    createdAt: "2026-11-06T10:00:00.000Z",
    input: { file_path: "/w/Reports/a.md", content: "x" },
    plain,
    ...patch,
  });

  test("Given a host in simple mode, Then the tray entry is host · task · plain sentence", () => {
    const menu = trayMenu([item()], en, (hostId) => hostId === "h1");
    expect(menu.items[0]?.label).toBe("alfa · Reports · Create the file a.md in Reports");
  });

  test("Given a host in full mode, or no wording, Then the entry is the tool and its summary as before", () => {
    const full = trayMenu([item()], en, () => false).items[0]?.label ?? "";
    const old = trayMenu([item({ plain: undefined })], en, () => true).items[0]?.label ?? "";
    expect([
      full.startsWith("alfa · Reports · Write"),
      old.startsWith("alfa · Reports · Write"),
    ]).toEqual([true, true]);
  });

  test("Given a summary with a wording, Then the item of what waits carries it", () => {
    const state = {
      hosts: [
        {
          id: "h1",
          name: "alfa",
          sessions: [
            {
              id: "s1",
              name: "Reports",
              cwd: "/w",
              status: "awaiting_permission",
              updatedAt: "t",
              pendingPermissions: asking(true).pendingPermissions,
            },
          ],
        },
      ],
      meta: {},
      externalRequests: {},
      externals: {},
      runs: {},
    };
    expect(needsYou(state as never, en)[0]?.plain).toEqual(plain);
  });
});
