import { describe, expect, test } from "bun:test";
import { paletteRoute } from "../../src/features/palette/palette-route.ts";

/** #1605 (Humble Object): the screen each palette entry opens, tested by output and without the DOM. */
describe("paletteRoute", () => {
  test("a session, an external session and a card open their own screen on their host", () => {
    expect(paletteRoute({ kind: "session", hostId: "h", sessionId: "s" })).toEqual({
      name: "session",
      host: "h",
      id: "s",
    });
    expect(paletteRoute({ kind: "external", hostId: "h", claudeSessionId: "c" })).toEqual({
      name: "external",
      host: "h",
      claudeSessionId: "c",
    });
    expect(paletteRoute({ kind: "card", hostId: "h", projectId: "p", cardId: "k" })).toEqual({
      name: "card",
      host: "h",
      projectId: "p",
      cardId: "k",
    });
  });

  test("a new session carries the persona only when one was picked", () => {
    expect(paletteRoute({ kind: "new-session", hostId: "h" })).toEqual({
      name: "new-session",
      host: "h",
    });
    expect(paletteRoute({ kind: "new-session", hostId: "h", persona: "host:x" })).toEqual({
      name: "new-session",
      host: "h",
      persona: "host:x",
    });
  });

  test("the project screens: the board, the workflows with the project's name, the list", () => {
    expect(paletteRoute({ kind: "board", hostId: "h", projectId: "p" })).toEqual({
      name: "board",
      host: "h",
      projectId: "p",
    });
    expect(paletteRoute({ kind: "workflows", hostId: "h", projectId: "p", name: "Shop" })).toEqual({
      name: "workflows",
      host: "h",
      projectId: "p",
      projectName: "Shop",
    });
    expect(paletteRoute({ kind: "projects", hostId: "h" })).toEqual({
      name: "projects",
      host: "h",
    });
    expect(paletteRoute({ kind: "host", hostId: "h" })).toEqual({ name: "host", host: "h" });
  });

  test("the screens with no host: settings, add host, costs, clients, and a go-to by name", () => {
    expect(paletteRoute({ kind: "settings" })).toEqual({ name: "settings" });
    expect(paletteRoute({ kind: "add-host" })).toEqual({ name: "add-host" });
    expect(paletteRoute({ kind: "costs" })).toEqual({ name: "costs" });
    expect(paletteRoute({ kind: "clients" })).toEqual({ name: "clients" });
    expect(paletteRoute({ kind: "go", to: "needs-you" })).toEqual({ name: "needs-you" });
  });

  test("a connect-ssh entry opens the connections screen on that target", () => {
    expect(paletteRoute({ kind: "connect-ssh", hostId: "h", targetId: "t" })).toEqual({
      name: "connections",
      connect: "t",
    });
  });
});
