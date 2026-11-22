import { afterEach, describe, expect, test } from "bun:test";
import type { Issue, IssuesConfig, Project } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { useState } = await import("react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { IssuesPanel } = await import("../../src/features/issues/issues-panel.tsx");

afterEach(cleanup);

const issue = (n: number): Issue => ({
  ref: `github:Acme/App#${n}`,
  id: String(n),
  title: `Issue number ${n}`,
  body: "",
  url: `https://github.com/Acme/App/issues/${n}`,
  author: "ana",
  labels: [],
  external: false,
  createdAt: "2026-10-01T10:00:00Z",
});

type Answer = { ok: true; data: unknown } | { ok: false; [key: string]: unknown };
const listed = (...numbers: number[]): Answer => ({
  ok: true,
  data: { issues: numbers.map(issue) },
});
const refused: Answer = {
  ok: false,
  code: "invalid_state",
  message: "gh issue list failed: To get started with GitHub CLI, please run: gh auth login",
  reason: "command_failed",
  params: {
    what: "gh issue list",
    output: "To get started with GitHub CLI, please run: gh auth login",
  },
};

/** A host whose answers come from queues; a function answer is awaited, so a test can hold one back. */
function host(queues: { list: Array<Answer | (() => Promise<Answer>)>; update?: Answer[] }) {
  const sent: Array<[string, unknown]> = [];
  const next = async (queue: Array<Answer | (() => Promise<Answer>)>): Promise<Answer> => {
    const item = queue.length > 1 ? queue.shift() : queue[0];
    return typeof item === "function" ? await item() : (item as Answer);
  };
  const request = async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return next(type === "issues.list" ? queues.list : (queues.update ?? []));
  };
  const store = (lang: "en" | "pt-BR") =>
    ({
      i18n: { t: translator(lang) },
      hostRequest: request,
      hostCommand: async (host_: string, type: string, payload: unknown) => {
        const answer = await request(host_, type, payload);
        return answer.ok ? answer.data : null;
      },
      openLink: () => undefined,
    }) as never;
  return { store, sent, lists: () => sent.filter(([type]) => type === "issues.list").length };
}

const project = (id: string, issues: IssuesConfig | null): Project =>
  ({ id, name: id, issues }) as never;

function Harness(props: Readonly<{ store: never; lang: "en" | "pt-BR"; start: Project }>) {
  const [current, setCurrent] = useState(props.start);
  return (
    <TContext.Provider value={translator(props.lang)}>
      <IssuesPanel
        store={props.store}
        hostId="h1"
        project={current}
        cards={[]}
        onClose={() => undefined}
        onProject={setCurrent}
        onOpenCard={() => undefined}
      />
    </TContext.Provider>
  );
}

/** The panel with the project held in state, so a saved project comes back to it as the page would. */
const show = (store: never, lang: "en" | "pt-BR", start: Project) =>
  render(<Harness store={store} lang={lang} start={start} />);

/** The panel with the project from its props: a rerender with another id is a switch of project. */
function Switch(props: Readonly<{ store: never; id: string }>) {
  return (
    <TContext.Provider value={translator("en")}>
      <IssuesPanel
        store={props.store}
        hostId="h1"
        project={project(props.id, { provider: "github" })}
        cards={[]}
        onClose={() => undefined}
        onProject={() => undefined}
        onOpenCard={() => undefined}
      />
    </TContext.Provider>
  );
}

const LANGS = [
  {
    lang: "en",
    title: "Issues",
    configure: "Configure issues",
    save: "Save",
    refresh: "Refresh",
    query: "Issues search",
    loading: "Loading issues",
    failed: "Could not list the issues",
    retry: "Try again",
  },
  {
    lang: "pt-BR",
    title: "Issues",
    configure: "Configurar issues",
    save: "Salvar",
    refresh: "Atualizar",
    query: "Busca de issues",
    loading: "Carregando issues",
    failed: "Não consegui listar as issues",
    retry: "Tentar de novo",
  },
] as const;

const panel = () => screen.getByRole("dialog", { name: "Issues" });
const rows = () => within(panel()).queryAllByRole("listitem").length;
const button = (name: string) => within(panel()).queryByRole("button", { name });
const press = async (name: string) => {
  const target = button(name);
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.click(target as HTMLElement);
  });
};
const alertText = () => within(panel()).queryByRole("alert")?.textContent ?? "";

describe.each(LANGS)("issues panel ($lang)", (words) => {
  test("Save on a connected project closes the form, asks for the list again and puts the focus on Configure", async () => {
    const h = host({
      list: [listed(1, 2), listed(3)],
      update: [{ ok: true, data: project("p1", { provider: "github", query: "label:x" }) }],
    });
    show(h.store(words.lang), words.lang, project("p1", { provider: "github" }));
    await settle(() => rows() === 2);
    expect(button(words.configure)?.getAttribute("aria-expanded")).toBe("false");
    await press(words.configure);
    expect(button(words.configure)?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.change(within(panel()).getByLabelText(words.query), {
        target: { value: "label:x" },
      });
    });
    await press(words.save);
    await settle(() => rows() === 1);
    expect(within(panel()).queryByText(words.loading)).toBeNull();
    expect(h.lists()).toBe(2);
    expect(button(words.configure)?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button(words.configure));
  });

  test("a refused save keeps the form and what was typed, and says why inside the panel", async () => {
    const h = host({ list: [listed(1)], update: [refused] });
    show(h.store(words.lang), words.lang, project("p1", { provider: "github" }));
    await settle(() => rows() === 1);
    await press(words.configure);
    await act(async () => {
      fireEvent.change(within(panel()).getByLabelText(words.query), {
        target: { value: "label:x" },
      });
    });
    await press(words.save);
    await settle(() => alertText() !== "");
    expect(alertText()).toContain("gh auth login");
    expect((within(panel()).getByLabelText(words.query) as HTMLInputElement).value).toBe("label:x");
    expect(button(words.save)).not.toBeNull();
  });

  test("a refused list says why, with a way to try again, and a retry lists", async () => {
    const h = host({ list: [refused, listed(1, 2)] });
    show(h.store(words.lang), words.lang, project("p1", { provider: "github" }));
    await settle(() => alertText() !== "");
    expect(alertText()).toContain(words.failed);
    expect(alertText()).toContain("gh auth login");
    await press(words.retry);
    await settle(() => rows() === 2);
    expect(alertText()).toBe("");
  });

  test("a refused Refresh shows the error and not the old list", async () => {
    const h = host({ list: [listed(1, 2), refused, listed(3)] });
    show(h.store(words.lang), words.lang, project("p1", { provider: "github" }));
    await settle(() => rows() === 2);
    await press(words.refresh);
    await settle(() => alertText() !== "");
    expect(rows()).toBe(0);
    await press(words.retry);
    await settle(() => rows() === 1);
  });

  test("Refresh is busy until the host answers, and a second press sends nothing", async () => {
    let release: (answer: Answer) => void = () => undefined;
    const held = () => new Promise<Answer>((resolve) => (release = resolve));
    const h = host({ list: [listed(1), held] });
    show(h.store(words.lang), words.lang, project("p1", { provider: "github" }));
    await settle(() => rows() === 1);
    await press(words.refresh);
    expect(button(words.refresh)?.getAttribute("aria-busy")).toBe("true");
    await press(words.refresh);
    expect(h.lists()).toBe(2);
    await act(async () => release(listed(1, 2)));
    await settle(() => rows() === 2);
    expect(button(words.refresh)?.getAttribute("aria-busy")).toBeNull();
  });
});

describe("issues panel: a late answer", () => {
  test("a slow answer for the project just left does not replace the list of the new one", async () => {
    let release: (answer: Answer) => void = () => undefined;
    const slow = () => new Promise<Answer>((resolve) => (release = resolve));
    const h = host({ list: [slow, listed(7)] });
    const store = h.store("en");
    const view = render(<Switch store={store} id="p1" />);
    await settle(() => h.lists() === 1);
    view.rerender(<Switch store={store} id="p2" />);
    await settle(() => rows() === 1);
    await act(async () => release(listed(1, 2, 3)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(rows()).toBe(1);
    expect(within(panel()).queryByText("Issue number 7")).not.toBeNull();
  });
});
