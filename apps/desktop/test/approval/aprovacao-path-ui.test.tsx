import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { loadConfig } from "../../../daemon/src/config.ts";
import { shortPath } from "../../src/features/permissions/domain/approval.ts";
import { inputSummary } from "../../src/features/sessions/domain/tool-input.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import {
  App,
  ApprovalCard,
  AppStore,
  AT,
  act,
  cleanups,
  fireEvent,
  group,
  inGroup,
  NOW,
  render,
  screen,
  settle,
  t,
  teardown,
  within,
} from "./aprovacao-setup.tsx";

setDefaultTimeout(30_000);
afterEach(teardown);

describe("aprovacao-ui", () => {
  test("o resumo de uma ferramenta sem campo conhecido é chave e valor, nunca JSON", () => {
    expect(inputSummary({ command: "npm test" })).toBe("npm test");
    expect(
      inputSummary({ repo: "acme/flightdeck-web", title: "Login falha", labels: ["bug", "p1"] }),
    ).toBe("repo: acme/flightdeck-web · title: Login falha · labels: bug, p1");
    expect(inputSummary({ opts: { deep: 1 } })).toBe("opts.deep: 1");
    const long = inputSummary({ title: "x".repeat(200) });
    expect(long).toHaveLength(81);
    expect(long.endsWith("…")).toBe(true);
    expect(inputSummary({})).toBe("");
    expect(inputSummary(null)).toBe("");
  });

  test("o caminho longo é cortado no meio, inteiro no tooltip", () => {
    expect(shortPath("/repo")).toBe("/repo");
    expect(
      shortPath("C:\\Users\\dev\\AppData\\Local\\Temp\\fd-demo-X\\alfa\\projects\\flightdeck-web"),
    ).toBe("C:\\Users\\…\\projects\\flightdeck-web");
    expect(shortPath("/home/dev/work/clients/acme/projects/flightdeck-web")).toBe(
      "/home/dev/…/projects/flightdeck-web",
    );
    // Too few segments to drop: cut by characters, still in the middle.
    const odd = shortPath(`/${"a".repeat(80)}`, 20);
    expect(odd.length).toBeLessThanOrEqual(20);
    expect(odd).toContain("…");
  });

  test("o cartão mostra a pasta curta com o caminho inteiro no tooltip e em Copiar pasta", async () => {
    const full = "C:\\Users\\dev\\AppData\\Local\\Temp\\fd-demo-X\\alfa\\projects\\flightdeck-web";
    const copied: string[] = [];
    render(
      <ApprovalCard
        request={{
          requestId: "r5",
          toolName: "Bash",
          input: { command: "ls" },
          cwd: full,
          createdAt: AT,
        }}
        t={t}
        nowMs={NOW}
        onCopyPath={(path) => copied.push(path)}
        onRespond={() => {}}
      />,
    );
    const card = group("Bash");
    const folder = card?.querySelector("[data-folder]");
    expect(folder?.textContent).toBe("C:\\Users\\…\\projects\\flightdeck-web");
    expect(folder?.getAttribute("title")).toBe(full);
    await act(async () => {
      fireEvent.click(inGroup(card, "Copiar pasta") as HTMLElement);
    });
    expect(copied).toEqual([full]);
  });

  test("a fila mostra o resumo de uma ferramenta MCP em chave e valor", async () => {
    const d = makeDaemon(cleanups);
    await d.central.hooksInstall(true);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.roster.add({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hook = async (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${(await loadConfig(d.configFile)).hooks.token}` },
        body: JSON.stringify({
          session_id: "ext-m",
          hook_event_name: event,
          cwd: d.project,
          ...body,
        }),
      }).catch(() => undefined);
    await hook("SessionStart", {});
    void hook("PermissionRequest", {
      tool_name: "mcp__github__create_issue",
      tool_input: { repo: "acme/flightdeck-web", title: "Login falha" },
    });
    await settle(() => Object.keys(store.getState().externalRequests).length === 1);
    await act(async () => store.router.push({ name: "needs-you" }));
    const queue = screen.queryByRole("main");
    const item = queue
      ? within(queue).queryByRole("button", { name: /mcp__github__create_issue/ })
      : null;
    expect(item).not.toBeNull();
    expect(item?.textContent ?? "").toContain("repo: acme/flightdeck-web · title: Login falha");
    expect(item?.textContent ?? "").not.toContain("{");
  });

  test("na sessão do terminal, Copiar pasta copia a pasta inteira do pedido de Bash", async () => {
    const d = makeDaemon(cleanups);
    await d.central.hooksInstall(true);
    const mem = memoryPlatform();
    const copied: string[] = [];
    mem.platform.copyText = async (text) => {
      copied.push(text);
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.roster.add({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    const hook = async (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${(await loadConfig(d.configFile)).hooks.token}` },
        body: JSON.stringify({
          session_id: "ext-b",
          hook_event_name: event,
          cwd: d.project,
          ...body,
        }),
      }).catch(() => undefined);
    await hook("SessionStart", {});
    void hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } });
    await settle(() => Object.keys(store.getState().externalRequests).length === 1);
    await act(async () =>
      store.router.push({ name: "external", host: hostId, claudeSessionId: "ext-b" }),
    );
    await settle(() => group("Bash") !== null);
    await act(async () => {
      fireEvent.click(inGroup(group("Bash"), "Copiar pasta") as HTMLElement);
    });
    expect(copied).toEqual([d.project]);
  });
});
