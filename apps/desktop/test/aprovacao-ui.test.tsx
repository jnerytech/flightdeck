import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { translator } from "../src/i18n/index.ts";
import { approvalView, shortPath } from "../src/lib/approval.ts";
import { inputSummary } from "../src/lib/tool-input.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const t = translator("pt-BR");
const AT = "2026-10-29T12:00:00.000Z";
const NOW = Date.parse(AT) + 3 * 60_000;

const group = (tool: string, within_: HTMLElement | null = document.body) =>
  within_ ? within(within_).queryByRole("group", { name: `Pedido de ${tool}` }) : null;
const inGroup = (g: HTMLElement | null, name: string) =>
  g ? within(g).queryByRole("button", { name }) : null;

describe("aprovacao-ui", () => {
  test("Bash mostra comando, descrição e pasta; Write e Edit o caminho relativo e a prévia; o resto em chave e valor", () => {
    expect(
      approvalView("Bash", { command: "npm test --silent", description: "Roda a suíte" }, "/repo"),
    ).toEqual({
      kind: "bash",
      command: "npm test --silent",
      description: "Roda a suíte",
      cwd: "/repo",
    });
    expect(
      approvalView("Write", { file_path: "/repo/src/a.ts", content: "l1\nl2" }, "/repo"),
    ).toEqual({
      kind: "file",
      path: "src/a.ts",
      lines: [
        { op: "+", text: "l1" },
        { op: "+", text: "l2" },
      ],
    });
    expect(
      approvalView(
        "Edit",
        { file_path: "C:\\repo\\src\\a.ts", old_string: "um", new_string: "dois" },
        "C:\\repo",
      ),
    ).toEqual({
      kind: "file",
      path: "src\\a.ts",
      lines: [
        { op: "-", text: "um" },
        { op: "+", text: "dois" },
      ],
    });
    // Outside the session's folder: the whole path.
    expect(approvalView("Write", { file_path: "/etc/hosts", content: "x" }, "/repo")).toMatchObject(
      {
        path: "/etc/hosts",
      },
    );
    expect(
      approvalView(
        "mcp__github__create_issue",
        {
          repo: "acme/x",
          title: "Login",
          labels: ["bug", "p1"],
          meta: { a: 1 },
          long: "y".repeat(250),
        },
        "/repo",
      ),
    ).toEqual({
      kind: "fields",
      entries: [
        ["repo", "acme/x"],
        ["title", "Login"],
        ["labels", "bug, p1"],
        ["meta.a", "1"],
        ["long", `${"y".repeat(200)}…`],
      ],
    });
  });

  test("o cartão: Aprovar e Negar juntos com a idade; o motivo só depois de Negar; A, N e Esc", async () => {
    const calls: unknown[][] = [];
    const request = {
      requestId: "r1",
      toolName: "Bash",
      input: { command: "npm test --silent", description: "Roda a suíte" },
      cwd: "/repo",
      createdAt: AT,
    };
    render(
      <ApprovalCard
        request={request}
        t={t}
        nowMs={NOW}
        alwaysAllow
        onRespond={(...args) => calls.push(args)}
      />,
    );
    const card = group("Bash");
    expect(card).not.toBeNull();
    expect(card?.querySelector("code")?.textContent).toBe("npm test --silent");
    expect(card?.textContent ?? "").toContain("Roda a suíte");
    expect(card?.textContent ?? "").toContain("/repo");
    expect(card?.textContent ?? "").toContain("há 3 min");
    expect(inGroup(card, "Sempre neste projeto")).not.toBeNull();
    expect(screen.queryByLabelText("Motivo (opcional)")).toBeNull();
    await act(async () => {
      fireEvent.click(inGroup(card, "Aprovar") as HTMLElement);
    });
    expect(calls).toEqual([["allow"]]);

    await act(async () => {
      fireEvent.click(inGroup(card, "Negar") as HTMLElement);
    });
    const reason = screen.queryByLabelText("Motivo (opcional)") as HTMLInputElement | null;
    expect(reason).not.toBeNull();
    await act(async () => {
      fireEvent.change(reason as HTMLInputElement, { target: { value: "aqui não" } });
    });
    await act(async () => {
      fireEvent.click(inGroup(card, "Negar") as HTMLElement);
    });
    expect(calls.at(-1)).toEqual(["deny", "aqui não"]);

    // Keys, with the card focused: A approves, N denies (the reason opens), Esc leaves it.
    cleanup();
    calls.length = 0;
    render(
      <ApprovalCard request={request} t={t} nowMs={NOW} onRespond={(...a) => calls.push(a)} />,
    );
    const focused = group("Bash") as HTMLElement;
    focused.focus();
    await act(async () => {
      fireEvent.keyDown(focused, { key: "a" });
    });
    expect(calls).toEqual([["allow"]]);
    await act(async () => {
      fireEvent.keyDown(focused, { key: "n" });
    });
    const typed = screen.queryByLabelText("Motivo (opcional)") as HTMLInputElement | null;
    expect(document.activeElement).toBe(typed);
    // Typing an "a" in the reason approves nothing.
    await act(async () => {
      fireEvent.keyDown(typed as HTMLInputElement, { key: "a" });
    });
    expect(calls).toEqual([["allow"]]);
    focused.focus();
    await act(async () => {
      fireEvent.keyDown(focused, { key: "Escape" });
    });
    expect(document.activeElement).not.toBe(focused);
  });

  test("Cancelar fecha o motivo e devolve Aprovar e Negar, sem responder", async () => {
    const calls: unknown[][] = [];
    render(
      <ApprovalCard
        request={{
          requestId: "r4",
          toolName: "Bash",
          input: { command: "ls" },
          cwd: null,
          createdAt: AT,
        }}
        t={t}
        nowMs={NOW}
        onRespond={(...args) => calls.push(args)}
      />,
    );
    const card = group("Bash");
    await act(async () => {
      fireEvent.click(inGroup(card, "Negar") as HTMLElement);
    });
    expect(screen.queryByLabelText("Motivo (opcional)")).not.toBeNull();
    await act(async () => {
      fireEvent.click(inGroup(card, "Cancelar") as HTMLElement);
    });
    expect(screen.queryByLabelText("Motivo (opcional)")).toBeNull();
    expect(inGroup(card, "Aprovar")).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test("ferramenta MCP em chave e valor, nunca JSON cru; pedido respondido diz como terminou", () => {
    render(
      <>
        <ApprovalCard
          request={{
            requestId: "r2",
            toolName: "mcp__github__create_issue",
            input: { repo: "acme/x", title: "Login falha" },
            cwd: null,
            createdAt: AT,
          }}
          t={t}
          nowMs={NOW}
          onRespond={() => {}}
        />
        <ApprovalCard
          request={{
            requestId: "r3",
            toolName: "Read",
            input: { file_path: "a" },
            cwd: null,
            createdAt: null,
          }}
          t={t}
          nowMs={NOW}
          resolution={{ decision: "deny", message: "não" }}
          onRespond={() => {}}
        />
      </>,
    );
    const mcp = group("mcp__github__create_issue");
    expect(mcp?.textContent ?? "").toContain("acme/x");
    expect(mcp?.textContent ?? "").toContain("Login falha");
    expect(mcp?.textContent ?? "").not.toContain("{");
    const answered = group("Read");
    expect(answered?.textContent ?? "").toContain("negado: não");
    expect(inGroup(answered, "Aprovar")).toBeNull();
  });

  test("o mesmo cartão na sessão gerenciada, na do terminal, no card e na fila lateral, que expande ali", async () => {
    const d = makeDaemon(cleanups);
    const repo = join(d.root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "app.ts"), "export const v = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    const project = await d.board.addProject({ path: repo, promptTemplate: "" });
    const card = d.board.createCard(project.id, { title: "Testar", description: "[bash]" });
    await d.board.startCard(card.id);
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "[bash]", name: "Pedinte" });
    await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
    const requestId = d.manager.pendingPermissions(sessionId)[0]?.requestId ?? "";

    const mem = memoryPlatform();
    const copied: string[] = [];
    mem.platform.copyText = async (text) => {
      copied.push(text);
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";

    // A terminal session asking for Edit (the app watches, so the receptor holds it).
    d.central.hooksInstall(true);
    const hook = (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
        body: JSON.stringify({ session_id: "ext-1", hook_event_name: event, cwd: repo, ...body }),
      }).catch(() => undefined);
    await hook("SessionStart", {});
    void hook("PermissionRequest", {
      tool_name: "Edit",
      tool_input: { file_path: join(repo, "app.ts"), old_string: "1", new_string: "2" },
    });
    await settle(() => Object.keys(store.getState().externalRequests).length === 1);

    // The managed session.
    await act(async () => store.router.push({ name: "session", host: hostId, id: sessionId }));
    await settle(() => group("Bash") !== null);
    expect(group("Bash")?.querySelector("code")?.textContent).toBe("npm test --silent");
    // Copiar pasta copies the session's whole folder.
    await act(async () => {
      fireEvent.click(inGroup(group("Bash"), "Copiar pasta") as HTMLElement);
    });
    expect(copied).toEqual([d.project]);
    // The terminal session.
    await act(async () =>
      store.router.push({ name: "external", host: hostId, claudeSessionId: "ext-1" }),
    );
    await settle(() => group("Edit") !== null);
    expect(group("Edit")?.textContent ?? "").toContain("app.ts");
    expect(group("Edit")?.textContent ?? "").not.toContain(repo);
    // A file's card has no folder line: nothing to copy there.
    expect(inGroup(group("Edit"), "Copiar pasta")).toBeNull();
    // The card.
    await act(async () =>
      store.router.push({ name: "card", host: hostId, projectId: project.id, cardId: card.id }),
    );
    await settle(() => group("Bash") !== null, 8000);
    expect(group("Bash")).not.toBeNull();

    // The queue: host and session, tool and summary, age; a click expands the card right there.
    await act(async () => store.router.push({ name: "needs-you" }));
    const queue = screen.queryByRole("main");
    const item = queue
      ? within(queue).queryByRole("button", { name: "alfa · Pedinte: Bash" })
      : null;
    expect(item).not.toBeNull();
    expect(item?.getAttribute("aria-pressed")).toBe("false");
    expect(item?.closest("li")?.textContent ?? "").toContain("npm test --silent");
    expect(item?.closest("li")?.textContent ?? "").toMatch(/agora|há \d+/);
    expect(group("Bash", queue)).toBeNull();
    await act(async () => {
      fireEvent.click(item as HTMLElement);
    });
    const expanded = group("Bash", queue);
    expect(expanded).not.toBeNull();
    expect(inGroup(expanded, "Abrir sessão")).not.toBeNull();
    await act(async () => {
      fireEvent.click(inGroup(expanded, "Copiar pasta") as HTMLElement);
    });
    expect(copied).toEqual([d.project, d.project]);
    await act(async () => {
      fireEvent.click(inGroup(expanded, "Aprovar") as HTMLElement);
    });
    await poll(() => d.manager.pendingPermissions(sessionId).length === 0);
    const status = d.eventStore.db
      .query("SELECT status FROM permission_requests WHERE id = ?")
      .get(requestId) as { status: string } | null;
    expect(status?.status).toBe("allowed");
  });

  test("o resumo de uma ferramenta sem campo conhecido é chave e valor, nunca JSON", () => {
    expect(inputSummary({ command: "npm test" })).toBe("npm test");
    expect(
      inputSummary({ repo: "acme/flightdeck-web", title: "Login falha", labels: ["bug", "p1"] }),
    ).toBe("repo: acme/flightdeck-web · title: Login falha · labels: bug, p1");
    expect(inputSummary({ opts: { deep: 1 } })).toBe("opts.deep: 1");
    const long = inputSummary({ title: "x".repeat(200) });
    expect(long.length).toBe(81);
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
    d.central.hooksInstall(true);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hook = (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
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
    d.central.hooksInstall(true);
    const mem = memoryPlatform();
    const copied: string[] = [];
    mem.platform.copyText = async (text) => {
      copied.push(text);
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    const hook = (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
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
