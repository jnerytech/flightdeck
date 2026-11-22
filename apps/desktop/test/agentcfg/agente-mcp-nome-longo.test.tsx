import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentMcp } = await import("../../src/features/agentcfg/agent-mcp.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

const NAME = "a-server-whose-name-is-long-enough-to-need-a-break-inside-the-row";

/** Issue #4269: the buttons that carry the server's name wrap it, so a long name never leaves the window. */
describe.each([
  ["en", [`Test ${NAME}`, `Edit ${NAME}`, `Remove ${NAME}`]],
  ["pt-BR", [`Testar ${NAME}`, `Editar ${NAME}`, `Remover ${NAME}`]],
] as const)("the MCP row of a long server name (%s)", (lang, names) => {
  test("its Test, Edit and Remove buttons carry the wrap-button style", async () => {
    const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
    await s.i18n.setLang(lang);
    s.hostCommand = (async (_host: string, type: string) =>
      type === "mcp.list"
        ? {
            servers: [
              {
                name: NAME,
                command: "node",
                origin: "project",
                readOnly: false,
                transport: "stdio",
                enabled: true,
              },
            ],
          }
        : null) as never;
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentMcp store={s} hostId="h1" projectId="p1" />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByRole("button", { name: names[0] }) !== null);
    expect(
      names.map((name) =>
        screen.queryByRole("button", { name })?.className.split(" ").includes("wrap-button"),
      ),
    ).toEqual([true, true, true]);
  });
});
