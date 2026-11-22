import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { ProjectsPage } = await import("../../src/features/projects/page.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);
const settle = waiter(1500);

const api = { id: "p1", name: "api", path: "/work/api", baseBranch: "main", projectKey: "k:api" };
const listOf = (maxParallelRuns = 3) => ({ projects: [api], maxParallelRuns });

type Reply = (type: string, payload: unknown) => unknown | Promise<unknown>;

/** The Projects page of a host whose daemon is a fake: `reply` answers each request, null is a refusal. */
function mount(reply: Reply, options: { language?: string; focus?: "board" } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: string[] = [];
  const toasts: string[] = [];
  store.success = (text: string) => {
    toasts.push(text);
  };
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push(`${type}:${JSON.stringify(payload)}`);
    return await reply(type, payload);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <ProjectsPage
        store={store}
        hostId="h1"
        hostName="alfa"
        focus={options.focus}
        onOpenBoard={() => {}}
        onOpenWorkflows={() => {}}
        automations={false}
        onOpenAutomations={() => {}}
        actions={false}
        onOpenActions={() => {}}
        rules={false}
        agent={false}
        onOpenAgent={() => {}}
      />
    </TContext.Provider>,
  );
  const count = (type: string) => sent.filter((s) => s.startsWith(`${type}:`)).length;
  return { sent, toasts, count };
}

const listed = () => screen.queryByRole("button", { name: "Open the board of api" }) !== null;

const press = async (button: HTMLElement) => {
  await act(async () => {
    fireEvent.click(button);
  });
};
const type = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};

describe.each([
  [
    "en",
    {
      failed: "Could not read this host's projects.",
      retry: "Try again",
      loading: "Loading projects",
    },
  ],
  [
    "pt-BR",
    {
      failed: "Não foi possível ler os projetos deste host.",
      retry: "Tentar de novo",
      loading: "Carregando projetos",
    },
  ],
] as const)("host projects page: a refused list (%s)", (language, words) => {
  const refuse: Reply = (kind) => (kind === "project.list" ? null : {});

  test("shows an error notice with a retry button in place of the loading state", async () => {
    mount(refuse, { language });
    await settle(() => screen.queryByRole("alert")?.textContent === words.failed);
    expect(screen.queryByRole("button", { name: words.retry })).not.toBeNull();
    expect(screen.queryByText(words.loading)).toBeNull();
  });

  test("the picker of Board says the same instead of staying blank", async () => {
    mount(refuse, { language, focus: "board" });
    await settle(() => screen.queryByRole("alert")?.textContent === words.failed);
    expect(screen.queryByRole("button", { name: words.retry })).not.toBeNull();
  });
});

describe("host projects page: a failed read next to the rest of the page", () => {
  test("while the limit is unknown the button is disabled and blames no field", async () => {
    mount((kind) => (kind === "project.list" ? null : {}));
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.getByRole("button", { name: "Save limit" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("The limit is a whole number of at least 1.")).toBeNull();
  });

  test("a later read that fails over an empty list does not also say there are no projects", async () => {
    let calls = 0;
    mount((kind) => {
      if (kind === "project.list")
        return ++calls === 1 ? { projects: [], maxParallelRuns: 3 } : null;
      return { id: "p2" };
    });
    await settle(() => screen.queryByText("No projects yet.") !== null);
    await type("Repository path", "/work/web");
    await press(screen.getByRole("button", { name: "Register project" }));
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByText("No projects yet.")).toBeNull();
  });

  test("a read that answers late does not overrule a newer one", async () => {
    let calls = 0;
    let lateRefusal: (value: unknown) => void = () => {};
    mount((kind) => {
      if (kind !== "project.list") return { id: "p2" };
      calls += 1;
      if (calls === 1) return null;
      return calls === 2 ? new Promise((resolve) => (lateRefusal = resolve)) : listOf();
    });
    await settle(() => screen.queryByRole("alert") !== null);
    await press(screen.getByRole("button", { name: "Try again" }));
    await type("Repository path", "/work/web");
    await press(screen.getByRole("button", { name: "Register project" }));
    await settle(() => listed());
    await act(async () => lateRefusal(null));
    expect(listed()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("host projects page: reading the list again", () => {
  test("a retry that works takes the notice away and shows the list", async () => {
    let calls = 0;
    mount((kind) => (kind === "project.list" && ++calls > 1 ? listOf() : null));
    await settle(() => screen.queryByRole("alert") !== null);
    await press(screen.getByRole("button", { name: "Try again" }));
    await settle(() => listed() && screen.queryByRole("alert") === null);
    expect(listed()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the retry button is busy while it reads, and a second press sends nothing", async () => {
    let release: (value: unknown) => void = () => {};
    let calls = 0;
    const { count } = mount((kind) => {
      if (kind !== "project.list") return {};
      calls += 1;
      return calls === 1 ? null : new Promise((resolve) => (release = resolve));
    });
    await settle(() => screen.queryByRole("alert") !== null);
    const retry = screen.getByRole("button", { name: "Try again" });
    await press(retry);
    await press(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(count("project.list")).toBe(2);
    await act(async () => release(listOf()));
  });

  test("a later read that fails keeps the old list and shows the notice above it", async () => {
    let calls = 0;
    mount((kind) => {
      if (kind === "project.list") return ++calls === 1 ? listOf() : null;
      return { id: "p2" };
    });
    await settle(() => listed());
    await type("Repository path", "/work/web");
    await press(screen.getByRole("button", { name: "Register project" }));
    await settle(
      () => screen.queryByRole("alert")?.textContent === "Could not read this host's projects.",
    );
    expect(listed()).toBe(true);
  });
});

describe.each([
  [
    "en",
    {
      save: "Save limit",
      reason: "The limit is a whole number of at least 1.",
      saved: "Parallel runs limit saved: 4.",
    },
  ],
  [
    "pt-BR",
    {
      save: "Salvar limite",
      reason: "O limite é um número inteiro de pelo menos 1.",
      saved: "Limite de execuções em paralelo salvo: 4.",
    },
  ],
] as const)("host projects page: Save limit (%s)", (language, words) => {
  const label = language === "en" ? "Parallel runs" : "Execuções em paralelo";
  const ready = async (reply: Reply = (kind) => (kind === "project.list" ? listOf() : {})) => {
    const page = mount(reply, { language });
    await settle(() => (screen.queryByLabelText(label) as HTMLInputElement | null)?.value === "3");
    return page;
  };
  const save = () => screen.getByRole("button", { name: words.save });

  test("an empty field, 0, a negative number or a decimal disables it with its reason and sends nothing", async () => {
    const { count } = await ready();
    for (const value of ["", "0", "-1", "2.5"]) {
      await type(label, value);
      expect(save().hasAttribute("disabled")).toBe(true);
      expect(screen.queryByText(words.reason)).not.toBeNull();
      await press(save());
    }
    expect(count("board.settings")).toBe(0);
  });

  test("a whole number is sent as a number, busy until the answer, then a toast names it; a second press sends nothing", async () => {
    let release: (value: unknown) => void = () => {};
    const { sent, toasts, count } = await ready((kind) =>
      kind === "board.settings" ? new Promise((resolve) => (release = resolve)) : listOf(),
    );
    await type(label, "4");
    expect(save().hasAttribute("disabled")).toBe(false);
    await press(save());
    await press(save());
    expect(save().getAttribute("aria-busy")).toBe("true");
    expect(count("board.settings")).toBe(1);
    expect(sent).toContain('board.settings:{"maxParallelRuns":4}');
    expect(toasts).toEqual([]);
    await act(async () => release({ maxParallelRuns: 4 }));
    await settle(() => toasts.length === 1);
    expect(toasts).toEqual([words.saved]);
  });

  test("a refusal shows no toast and the button is usable again", async () => {
    const { toasts, count } = await ready((kind) => (kind === "board.settings" ? null : listOf()));
    await type(label, "4");
    await press(save());
    await settle(() => count("board.settings") === 1 && save().getAttribute("aria-busy") === null);
    expect(toasts).toEqual([]);
    expect(save().hasAttribute("disabled")).toBe(false);
  });
});
