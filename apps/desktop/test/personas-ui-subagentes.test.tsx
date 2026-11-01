import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { settle } from "./wait.ts";

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

const LABEL = "Personas como subagentes";

describe("personas-ui: the subagent switch of a project", () => {
  test("the agent screen shows which personas the project offers as subagents, and a change is kept on the project", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const { d, hostId, projectId } = await personasHost(cleanups, store);
    render(<App store={store} />);
    await settle(
      () => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true,
    );
    await act(async () => {
      store.router.push({ name: "agent", host: hostId, projectId, projectName: "repo" });
    });
    await settle(() => screen.queryByLabelText(LABEL) !== null);
    const field = screen.queryByLabelText(LABEL) as HTMLSelectElement | null;
    expect(field).not.toBeNull();
    expect([...(field?.options ?? [])].map((o) => o.value)).toEqual(["all", "project", "none"]);
    await settle(() => field?.value === "all");
    expect(field?.value).toBe("all");
    await act(async () => {
      fireEvent.change(field as HTMLSelectElement, { target: { value: "none" } });
    });
    await poll(() => d.board.getProject(projectId).personaSubagents === "none");
    expect(d.board.getProject(projectId).personaSubagents).toBe("none");
  });
});
