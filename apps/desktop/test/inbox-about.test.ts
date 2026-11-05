import { describe, expect, test } from "bun:test";
import type { PendingPermission } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { externalRequestNotification, summaryNotifications } from "../src/lib/notify.ts";

const en = translator("en");
const names = { subject: "Sessão A", host: "wsl", group: "h1/s1" };
const base = { status: "running" as const, pendingPermissions: [] as PendingPermission[] };
const asking = (toolName: string, input?: Record<string, unknown>) => ({
  status: "awaiting_permission" as const,
  pendingPermissions: [{ requestId: "r1", toolName, createdAt: "t", ...(input ? { input } : {}) }],
});

describe("inbox-about: what a notification says it is about", () => {
  test("a managed session's request names the session and the host and says what it asks, in words", () => {
    const [n] = summaryNotifications(
      base,
      asking("AskUserQuestion", { questions: [{ question: "Which DB?" }] }),
      "wsl · Sessão A",
      false,
      undefined,
      en,
      names,
    );
    expect(n?.about).toEqual({
      subject: "Sessão A",
      host: "wsl",
      ask: "Asks: Which DB?",
      group: "h1/s1",
    });
    // The OS notification keeps its own text.
    expect(n?.title).toBe("wsl · Sessão A: needs you");
  });

  test("the end of a turn names the session and host, and does not collapse with others", () => {
    const out = summaryNotifications(
      { ...base, status: "running" },
      { ...base, status: "idle" },
      "wsl · Sessão A",
      false,
      undefined,
      en,
      names,
    );
    expect(out[0]?.about).toEqual({ subject: "Sessão A", host: "wsl" });
  });

  test("without names a notification carries no about, as before", () => {
    const [n] = summaryNotifications(base, asking("Bash"), "x", false, undefined, en);
    expect(n).not.toHaveProperty("about");
  });

  test("a terminal session's request keeps its title, body and link, and names the session, the host and the question", () => {
    const n = externalRequestNotification(
      {
        hostId: "h1",
        hostName: "wsl",
        subject: "Sessão A",
        claudeSessionId: "c-1",
        toolName: "AskUserQuestion",
        input: { questions: [{ question: "Which DB?" }] },
        link: "flightdeck://request?host=h1&request=ext-1",
      },
      en,
    );
    expect(n).toEqual({
      title: "Needs you",
      body: "wsl · AskUserQuestion",
      link: "flightdeck://request?host=h1&request=ext-1",
      about: { subject: "Sessão A", host: "wsl", ask: "Asks: Which DB?", group: "h1/c-1" },
    });
  });
});
