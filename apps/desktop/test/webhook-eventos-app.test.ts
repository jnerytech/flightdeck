import { describe, expect, test } from "bun:test";
import type { ExternalPermissionFrame, ExternalSession, WatchInfo } from "@flightdeck/protocol";
import type { SidebarSession } from "../src/lib/app-store.ts";
import { WebhookFeed } from "../src/lib/webhook-feed.ts";
import type { WebhookSource } from "../src/lib/webhooks.ts";

const HOST = { id: "pi", name: "Pi" };

function setup() {
  const sources: WebhookSource[] = [];
  const feed = new WebhookFeed(
    { emit: async (source) => void sources.push(source) },
    (hostId, cwd) => (cwd?.startsWith("/acme") ? `client-of-${hostId}` : null),
    () => 1_793_534_000_000,
  );
  return { feed, sources };
}

const session = (over: Partial<SidebarSession> = {}): SidebarSession => ({
  id: "s1",
  name: "api work",
  cwd: "/acme/api",
  status: "running",
  pendingPermissions: [],
  updatedAt: "2026-11-01T12:00:00.000Z",
  ...over,
});

const permission = (requestId: string, toolName = "Bash") =>
  ({ requestId, toolName }) as SidebarSession["pendingPermissions"][number];

describe("webhook-eventos-app", () => {
  test("a new permission request of a managed session is a needs_you event, once", () => {
    const { feed, sources } = setup();
    const before = session({ pendingPermissions: [permission("r1")] });
    const after = session({
      status: "awaiting_permission",
      pendingPermissions: [permission("r1"), permission("r2", "Edit")],
    });
    feed.managed(HOST, before, after);
    expect(sources).toEqual([
      {
        id: "pi/r2",
        kind: "needs_you",
        hostId: "pi",
        hostName: "Pi",
        clientId: "client-of-pi",
        project: null,
        title: "api work",
        detail: "Allow Edit?",
      },
    ]);
  });

  test("the first summary seen is not news, and a session with no name is titled by its folder", () => {
    const { feed, sources } = setup();
    feed.managed(HOST, undefined, session({ pendingPermissions: [permission("r1")] }));
    expect(sources).toEqual([]);
    feed.managed(
      HOST,
      session(),
      session({ name: null, cwd: "/acme/web", pendingPermissions: [permission("r9")] }),
    );
    expect(sources[0]?.title).toBe("web");
  });

  test("a session that ends or fails is told once, when the status changes", () => {
    const { feed, sources } = setup();
    feed.managed(HOST, session(), session({ status: "ended" }));
    feed.managed(HOST, session({ status: "ended" }), session({ status: "ended" }));
    feed.managed(HOST, session(), session({ status: "error" }));
    expect(sources.map((s) => [s.kind, s.id])).toEqual([
      ["session_ended", "pi/s1/ended"],
      ["session_failed", "pi/s1/error"],
    ]);
  });

  test("an external permission request opens a needs_you event with the session to summarize", () => {
    const { feed, sources } = setup();
    const frame = {
      requestId: "ext-1",
      claudeSessionId: "c-1",
      toolName: "Bash",
      state: "open",
    } as ExternalPermissionFrame;
    feed.externalPermission(HOST, frame, "/acme/api");
    feed.externalPermission(HOST, { ...frame, state: "closed" }, "/acme/api");
    expect(sources).toEqual([
      {
        id: "pi/ext-1",
        kind: "needs_you",
        hostId: "pi",
        hostName: "Pi",
        clientId: "client-of-pi",
        project: null,
        title: "api",
        detail: "Allow Bash?",
        claudeSessionId: "c-1",
      },
    ]);
  });

  test("an external session that ends is a session_ended event with its summary", () => {
    const { feed, sources } = setup();
    const running = {
      claudeSessionId: "c-1",
      cwd: "/work/app",
      status: "running",
      projectKey: "github.com/acme/app",
      meta: { name: "app run" },
    } as ExternalSession;
    feed.externalSession(HOST, running, { ...running, status: "ended" });
    feed.externalSession(HOST, undefined, { ...running, status: "ended" });
    feed.externalSession(HOST, { ...running, status: "ended" }, { ...running, status: "ended" });
    expect(sources).toEqual([
      {
        id: "pi/c-1/ended",
        kind: "session_ended",
        hostId: "pi",
        hostName: "Pi",
        clientId: null,
        project: "github.com/acme/app",
        title: "app run",
        detail: null,
        claudeSessionId: "c-1",
      },
    ]);
  });

  test("a budget threshold is a budget_alert event; a client budget carries its client", () => {
    const { feed, sources } = setup();
    feed.budget(HOST, "host budget (day)", 80, "US$ 10.00");
    feed.clientBudget("Acme", "acme", 100, "US$ 500.00");
    expect(sources).toEqual([
      {
        id: "pi/budget/1793534000000",
        kind: "budget_alert",
        hostId: "pi",
        hostName: "Pi",
        clientId: null,
        project: null,
        title: "host budget (day)",
        detail: "80% of US$ 10.00",
      },
      {
        id: "client/acme/1793534000000",
        kind: "budget_alert",
        hostId: "",
        hostName: "Flightdeck",
        clientId: "acme",
        project: null,
        title: "Acme",
        detail: "100% of US$ 500.00",
      },
    ]);
  });

  test("a PR watch that starts to need you is a pr_watch event, once", () => {
    const { feed, sources } = setup();
    const watching = { cardId: "k1", status: "watching", reason: null } as WatchInfo;
    const needs = { cardId: "k1", status: "needs_you", reason: "two rounds failed" } as WatchInfo;
    feed.watch(HOST, "Fix login", undefined, watching);
    feed.watch(HOST, "Fix login", watching, needs);
    feed.watch(HOST, "Fix login", needs, needs);
    expect(sources).toEqual([
      {
        id: "pi/k1/watch/1793534000000",
        kind: "pr_watch",
        hostId: "pi",
        hostName: "Pi",
        clientId: null,
        project: null,
        title: "Fix login",
        detail: "two rounds failed",
      },
    ]);
  });
});
