import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentMcp } = await import("../../src/features/agentcfg/agent-mcp.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #4081: the MCP tab names its switch by the server, has no empty list, announces results and keeps Test focusable. */
const WORDS = {
  en: {
    list: "MCP servers",
    empty: "No MCP servers in this project.",
    test: "Test eco",
    testing: "Testing eco…",
    run: "Run and test",
    tools: "Tools of eco",
  },
  "pt-BR": {
    list: "Servidores MCP",
    empty: "Nenhum servidor MCP neste projeto.",
    test: "Testar eco",
    testing: "Testando eco…",
    run: "Executar e testar",
    tools: "Ferramentas de eco",
  },
} as const;

const SERVER = (name: string, enabled: boolean) => ({
  name,
  command: "node",
  origin: "project",
  readOnly: false,
  transport: "stdio",
  enabled,
});

/** A project with a live session, whose host lists `servers`, reports `status`, and answers a test when `release()` is called. */
async function mount(lang: Lang, servers: unknown[], status: unknown[] = []) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  seedHosts(s, [{ id: "h1", name: "pc", online: true, features: [] }]);
  const hidden = s as unknown as { state: Record<string, unknown> };
  const host = (hidden.state.hosts as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  host.sessions = [{ id: "s1", name: "Carrinho", status: "idle", cwd: "/repo" }];
  hidden.state = { ...hidden.state, projects: { h1: [{ id: "p1", path: "/repo", name: "repo" }] } };
  const sent: Array<{ type: string; confirm: unknown }> = [];
  let release: (value: unknown) => void = () => {};
  s.hostCommand = ((_host: string, type: string, args: { confirm?: boolean }) => {
    sent.push({ type, confirm: args?.confirm });
    if (type === "mcp.list") return Promise.resolve({ servers });
    if (type === "mcp.status") return Promise.resolve({ servers: status });
    if (type === "mcp.test" && !args.confirm)
      return Promise.resolve({ preview: { command: "node", args: ["eco.js"] } });
    if (type === "mcp.test") return new Promise((resolve) => (release = resolve));
    return Promise.resolve(null);
  }) as never;
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentMcp store={s} hostId="h1" projectId="p1" />
    </TContext.Provider>,
  );
  await act(async () => {});
  return { w: WORDS[lang], sent, release: (value: unknown) => release(value) };
}

const press = (name: string) =>
  act(async () => {
    fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
  });

describe.each(["en", "pt-BR"] as const)("the MCP tab, accessibility (%s)", (lang) => {
  test("a switch is named by its server, on or off", async () => {
    await mount(lang, [SERVER("eco", true), SERVER("api", false)]);
    await settle(() => screen.queryByRole("listitem", { name: "eco" }) !== null);
    const eco = screen.queryByRole("switch", { name: "eco" });
    const api = screen.queryByRole("switch", { name: "api" });
    expect(eco?.getAttribute("aria-checked")).toBe("true");
    expect(api?.getAttribute("aria-checked")).toBe("false");
  });

  test("with no server only the empty state shows, and no empty list", async () => {
    const { w } = await mount(lang, []);
    await settle(() => screen.queryByText(w.empty) !== null);
    expect(screen.queryByText(w.empty)).not.toBeNull();
    expect(screen.queryByRole("list", { name: w.list })).toBeNull();
  });

  test("a failed live status is an alert", async () => {
    await mount(lang, [SERVER("eco", true)], [{ name: "eco", status: "failed", error: "boom" }]);
    await settle(() => screen.queryByText("boom") !== null);
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("boom");
  });

  test("a test in flight keeps its button focusable and busy, and its result is announced", async () => {
    const { w, sent, release } = await mount(lang, [SERVER("eco", true)]);
    await settle(() => screen.queryByRole("button", { name: w.test }) !== null);
    await press(w.test);
    await settle(() => screen.queryByRole("alertdialog") !== null);
    await press(w.run);
    await settle(() => screen.queryByRole("button", { name: w.testing }) !== null);
    const button = screen.queryByRole("button", { name: w.testing }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await press(w.testing);
    expect(sent.filter((call) => call.type === "mcp.test" && call.confirm === true)).toHaveLength(
      1,
    );
    await act(async () => release({ tools: ["eco"], resources: [] }));
    await settle(() => screen.queryByText(w.tools) !== null);
    const row = screen.queryByRole("listitem", { name: "eco" }) as HTMLElement;
    expect(within(row).queryByRole("status")?.textContent ?? "").toContain(w.tools);
  });
});
