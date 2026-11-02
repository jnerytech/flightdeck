import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

describe("ask-question-flow", () => {
  test("a terminal session's AskUserQuestion is answered in the app and the hook gets the answers", async () => {
    const d = makeDaemon(cleanups);
    const repo = join(d.root, "repo");
    mkdirSync(repo);
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    d.central.hooksInstall(true);
    const hook = (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
        body: JSON.stringify({ session_id: "ext-q", hook_event_name: event, cwd: repo, ...body }),
      });
    await hook("SessionStart", {});
    const input = {
      questions: [
        {
          question: "Which database?",
          header: "Database",
          multiSelect: false,
          options: [{ label: "SQLite", description: "Embedded" }],
        },
      ],
    };
    const answer = hook("PermissionRequest", { tool_name: "AskUserQuestion", tool_input: input });
    await settle(() => Object.keys(store.getState().externalRequests).length === 1);
    await act(async () =>
      store.router.push({ name: "external", host: hostId, claudeSessionId: "ext-q" }),
    );
    await settle(() => screen.queryByRole("radio", { name: /SQLite/ }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("radio", { name: /SQLite/ }) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Send answers" }) as HTMLElement);
    });
    const body = (await (await answer).json()) as {
      hookSpecificOutput: { decision: { behavior: string; updatedInput: unknown } };
    };
    expect(body.hookSpecificOutput.decision).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which database?": "SQLite" } },
    });
  });
});
