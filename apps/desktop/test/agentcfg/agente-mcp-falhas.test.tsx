import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentMcp } = await import("../../src/features/agentcfg/agent-mcp.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #4267: the New server form opens with no error, a refused action says why in the panel, and Remove keeps the focus in the list. */
const WORDS = {
  en: {
    add: "Add server",
    name: "Server name",
    command: "Command",
    save: "Save to .mcp.json",
    needName: "Give the server a name.",
    needCommand: "The command is missing.",
    test: (n: string) => `Test ${n}`,
    run: "Run and test",
    remove: (n: string) => `Remove ${n}`,
    removeConfirm: "Remove server",
  },
  "pt-BR": {
    add: "Adicionar servidor",
    name: "Nome do servidor",
    command: "Comando",
    save: "Salvar no .mcp.json",
    needName: "Dê um nome ao servidor.",
    needCommand: "Falta o comando.",
    test: (n: string) => `Testar ${n}`,
    run: "Executar e testar",
    remove: (n: string) => `Remover ${n}`,
    removeConfirm: "Remover servidor",
  },
} as const;

const SERVER = (name: string) => ({
  name,
  command: "node",
  origin: "project",
  readOnly: false,
  transport: "stdio",
  enabled: true,
});

type Result = { ok: true; data: unknown } | { ok: false; code: string; message: string };
const refusal = (message: string): Result => ({ ok: false, code: "bad_request", message });
const done = (servers: unknown[]): Result => ({ ok: true, data: { servers } });

/** The MCP tab over a host that lists `names`; `answer` says how each write-side command ends. */
async function mount(
  lang: Lang,
  names: string[],
  answer: (type: string, payload: Record<string, unknown>) => Result | Promise<Result>,
) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  const asked: string[] = [];
  s.hostCommand = (async (_host: string, type: string) => {
    if (type === "mcp.list") return { servers: names.map(SERVER) };
    return null;
  }) as never;
  s.hostRequest = (async (_host: string, type: string, payload: Record<string, unknown>) => {
    asked.push(type);
    return answer(type, payload);
  }) as never;
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentMcp store={s} hostId="h1" projectId="p1" />
    </TContext.Provider>,
  );
  await settle(() => screen.queryByRole("button", { name: WORDS[lang].add }) !== null);
  return { w: WORDS[lang], asked };
}

describe.each(["en", "pt-BR"] as const)("the MCP tab, forms and refusals (%s)", (lang) => {
  const focused = () => document.activeElement as HTMLElement | null;
  const alerts = () =>
    screen
      .queryAllByRole("alert")
      .map((a) => a.textContent ?? "")
      .join(" | ");
  const row = (name: string) => screen.queryByRole("listitem", { name }) as HTMLElement;

  async function press(name: string) {
    const element = screen.queryByRole("button", { name });
    expect(element).not.toBeNull();
    await act(async () => {
      fireEvent.click(element as HTMLElement);
    });
    await uiIdle();
  }
  async function fill(label: string, value: string) {
    await act(async () => {
      fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });
    });
  }
  async function leave(label: string) {
    await act(async () => {
      fireEvent.blur(screen.queryByLabelText(label) as HTMLElement);
    });
  }
  async function submit(label: string) {
    await act(async () => {
      fireEvent.submit((screen.queryByLabelText(label) as HTMLElement).closest("form") as Element);
    });
    await uiIdle();
  }
  const saveButton = (name: string) =>
    screen.queryByRole("button", { name }) as HTMLButtonElement | null;

  test("the New server form opens with no alert, Save off, and the reason as plain text", async () => {
    const { w } = await mount(lang, [], () => done([]));
    await press(w.add);
    await settle(() => screen.queryByLabelText(w.name) !== null);
    expect({
      alerts: alerts(),
      saveOff: saveButton(w.save)?.disabled,
      reason: screen.queryByText(w.needName) !== null,
    }).toEqual({ alerts: "", saveOff: true, reason: true });
  });

  test("leaving the empty name field says the name is missing, as an alert", async () => {
    const { w } = await mount(lang, [], () => done([]));
    await press(w.add);
    await leave(w.name);
    expect(alerts()).toContain(w.needName);
  });

  test("trying to save with the name empty says so, and sends nothing", async () => {
    const { w, asked } = await mount(lang, [], () => done([]));
    await press(w.add);
    await submit(w.name);
    expect({ alerts: alerts().includes(w.needName), asked }).toEqual({ alerts: true, asked: [] });
  });

  test("a name with no command says the command is missing only after that field was left", async () => {
    const { w } = await mount(lang, [], () => done([]));
    await press(w.add);
    await fill(w.name, "eco");
    const before = alerts();
    await leave(w.command);
    expect({ before, after: alerts().includes(w.needCommand) }).toEqual({
      before: "",
      after: true,
    });
  });

  test("a refused Save keeps the form open with the refusal, and the next try clears it", async () => {
    let release: (value: Result) => void = () => {};
    let nth = 0;
    const { w } = await mount(lang, [], (type) => {
      if (type !== "mcp.save") return done([]);
      nth += 1;
      if (nth === 1) return refusal("name-already-there");
      return new Promise<Result>((resolve) => {
        release = resolve;
      });
    });
    await press(w.add);
    await fill(w.name, "eco");
    await fill(w.command, "node");
    await submit(w.name);
    const refused = { open: screen.queryByLabelText(w.name) !== null, said: alerts() };
    await submit(w.name);
    const retrying = alerts();
    await act(async () => release(done([SERVER("eco")])));
    expect({
      open: refused.open,
      said: refused.said.includes("name-already-there"),
      retrying,
    }).toEqual({
      open: true,
      said: true,
      retrying: "",
    });
  });

  test("a refused Test (the preview step) says why in the server's row", async () => {
    const { w } = await mount(lang, ["eco"], () => refusal("cannot-preview"));
    await press(w.test("eco"));
    expect(within(row("eco")).queryByRole("alert")?.textContent ?? "").toContain("cannot-preview");
  });

  test("a refused Test (the run step) says why in the row, and the next try clears it", async () => {
    let nth = 0;
    const { w } = await mount(lang, ["eco"], (_type, payload) => {
      if (!payload.confirm) return { ok: true, data: { preview: { command: "node", args: [] } } };
      nth += 1;
      return nth === 1 ? refusal("cannot-run") : new Promise<Result>(() => {});
    });
    await press(w.test("eco"));
    await press(w.run);
    const said = within(row("eco")).queryByRole("alert")?.textContent ?? "";
    await press(w.test("eco"));
    // The confirm dialog of the next try hides the row from role queries: look in the DOM.
    const listed = [...document.querySelectorAll("li")].find(
      (li) => li.getAttribute("aria-label") === "eco",
    );
    expect({
      said: said.includes("cannot-run"),
      next: listed?.querySelector("[role=alert]") === null,
    }).toEqual({
      said: true,
      next: true,
    });
  });

  test("a refused toggle says why in the row, and the switch stays as saved", async () => {
    await mount(lang, ["eco"], () => refusal("cannot-toggle"));
    await act(async () => {
      fireEvent.click(screen.queryByRole("switch", { name: "eco" }) as HTMLElement);
    });
    await uiIdle();
    expect({
      said: (within(row("eco")).queryByRole("alert")?.textContent ?? "").includes("cannot-toggle"),
      on: screen.queryByRole("switch", { name: "eco" })?.getAttribute("aria-checked"),
    }).toEqual({ said: true, on: "true" });
  });

  test("a refused Remove says why in the row, and the row stays", async () => {
    const { w } = await mount(lang, ["eco"], () => refusal("cannot-remove"));
    await press(w.remove("eco"));
    await press(w.removeConfirm);
    expect({
      said: (within(row("eco")).queryByRole("alert")?.textContent ?? "").includes("cannot-remove"),
      stays: row("eco") !== null,
    }).toEqual({ said: true, stays: true });
  });

  test("after Remove, the focus goes to the next row", async () => {
    const { w } = await mount(lang, ["eco", "api", "zed"], () => done(["eco", "zed"].map(SERVER)));
    await settle(() => row("api") !== null);
    await press(w.remove("api"));
    await press(w.removeConfirm);
    await uiIdle();
    expect(row("zed")?.contains(focused())).toBe(true);
  });

  test("after Remove of the last row, the focus goes to the row before it", async () => {
    const { w } = await mount(lang, ["eco", "api"], () => done([SERVER("eco")]));
    await settle(() => row("api") !== null);
    await press(w.remove("api"));
    await press(w.removeConfirm);
    await uiIdle();
    expect(row("eco")?.contains(focused())).toBe(true);
  });

  test("after Remove of the only server, the focus goes to Add server", async () => {
    const { w } = await mount(lang, ["eco"], () => done([]));
    await press(w.remove("eco"));
    await press(w.removeConfirm);
    await uiIdle();
    expect(focused() === screen.queryByRole("button", { name: w.add })).toBe(true);
  });
});
