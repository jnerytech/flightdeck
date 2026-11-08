import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { KnowledgeEntry } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Issue #1039: a new document from a template, started from the knowledge panel. */
const entry = (path: string, over: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  path,
  title: path,
  type: "adr",
  status: "valid",
  supersedes: null,
  bytes: 1200,
  changedAt: "2026-11-05T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: `hash-of-${path}`,
  ...over,
});

const LIST = {
  truncated: false,
  entries: [
    entry("docs/adr/0003-new.md", { title: "Use the outbox" }),
    entry("docs/decisions/2026-01-01-x.md", { title: "Old decision", status: "unclassified" }),
  ],
};

type Answer = { ok: true; data: unknown } | { ok: false; [key: string]: unknown };

function setup(options: { language?: "en" | "pt-BR"; features?: string[]; answer?: Answer } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return type === "knowledge.list" ? LIST : null;
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return (
      options.answer ?? {
        ok: true,
        data: entry("docs/adr/0004-use-the-queue.md", { status: "transitional" }),
      }
    );
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: {
          daemonVersion: "x",
          features: options.features ?? ["knowledge", "knowledgeCreate"],
        },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = <ProjectPage store={store} state={state} hostId="h1" projectId="p1" go={() => {}} />;
  return { view, sent };
}

const panel = () => screen.getByRole("region", { name: "Project knowledge" });
const listed = async () =>
  await waitFor(() => expect(within(panel()).queryByText("Use the outbox")).not.toBeNull());
const created = (sent: Array<[string, unknown]>) =>
  sent.filter(([type]) => type === "knowledge.create");

describe("knowledge-create-ui: starting a document from a template (#1039)", () => {
  test("the panel offers a kind and a title, and says the draft is not committed", async () => {
    render(setup().view);
    await listed();
    const kind = within(panel()).getByRole("combobox", { name: "Kind" }) as HTMLSelectElement;
    expect([
      [...kind.options].map((o) => o.textContent),
      within(panel()).queryByRole("textbox", { name: "Title" }) !== null,
      (panel().textContent ?? "").includes("Nothing is committed."),
    ]).toEqual([
      ["Decision record (ADR)", "Proposal (RFC)", "Product requirements (PRD)"],
      true,
      true,
    ]);
  });

  test("Create sends the kind and the title, says which file was written, empties the title and reads the list again", async () => {
    const { view, sent } = setup();
    render(view);
    await listed();
    fireEvent.change(within(panel()).getByRole("combobox", { name: "Kind" }), {
      target: { value: "rfc" },
    });
    const title = within(panel()).getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Use the queue" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Create from template" }));
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "Created docs/adr/0004-use-the-queue.md. The file is in the project's folder and not committed.",
        ),
      ).not.toBeNull(),
    );
    expect(created(sent)).toEqual([
      ["knowledge.create", { path: "/work/api", kind: "rfc", title: "Use the queue" }],
    ]);
    expect(title.value).toBe("");
    expect(sent.filter(([type]) => type === "knowledge.list")).toHaveLength(2);
  });

  test("Create waits for a title: an empty or blank one sends nothing", async () => {
    const { view, sent } = setup();
    render(view);
    await listed();
    const button = within(panel()).getByRole("button", { name: "Create from template" });
    fireEvent.click(button);
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Title" }), {
      target: { value: "   " },
    });
    fireEvent.click(button);
    expect([(button as HTMLButtonElement).disabled, created(sent)]).toEqual([true, []]);
  });

  test("a refusal is written out in words and the title is kept for another try", async () => {
    const { view } = setup({
      answer: {
        ok: false,
        code: "file_conflict",
        message: "exists",
        reason: "knowledge_exists",
        params: { path: "docs/prd/card-pins.md" },
      },
    });
    render(view);
    await listed();
    const title = within(panel()).getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Card pins" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Create from template" }));
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "The document could not be created. A document named docs/prd/card-pins.md already exists: nothing was overwritten.",
        ),
      ).not.toBeNull(),
    );
    expect(title.value).toBe("Card pins");
  });

  test("a host that does not announce knowledgeCreate shows no such control", async () => {
    render(setup({ features: ["knowledge"] }).view);
    await listed();
    expect([
      within(panel()).queryByRole("combobox", { name: "Kind" }) === null,
      within(panel()).queryByRole("textbox", { name: "Title" }) === null,
    ]).toEqual([true, true]);
  });

  test("the control is written in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }).view);
    const region = await screen.findByRole("region", { name: "Conhecimento do projeto" });
    await waitFor(() =>
      expect(within(region).queryByRole("combobox", { name: "Tipo" })).not.toBeNull(),
    );
    expect([
      within(region).queryByRole("textbox", { name: "Título" }) !== null,
      within(region).queryByRole("button", { name: "Criar a partir do modelo" }) !== null,
    ]).toEqual([true, true]);
  });
});

// #1104: the title was a blank box with only an aria-label, and Create was off with no reason. Both
// controls now show their label, and Create says what it waits for.
describe("knowledge-create-ui: the form says what each box is and what Create waits for (#1104)", () => {
  for (const [language, names] of [
    [
      "en",
      {
        panel: "Project knowledge",
        labels: ["Kind", "Title"],
        create: "Create from template",
        reason: "Type the document's title.",
      },
    ],
    [
      "pt-BR",
      {
        panel: "Conhecimento do projeto",
        labels: ["Tipo", "Título"],
        create: "Criar a partir do modelo",
        reason: "Digite o título do documento.",
      },
    ],
  ] as const) {
    test(`${language}: the kind and the title have visible labels, and Create's reason shows until a title is typed`, async () => {
      render(setup({ language }).view);
      const region = () => screen.queryByRole("region", { name: names.panel });
      await waitFor(() => expect(region()).not.toBeNull());
      const inside = within(region() as HTMLElement);
      await waitFor(() =>
        expect(inside.queryByRole("textbox", { name: names.labels[1] })).not.toBeNull(),
      );
      const visible = Array.from(region()?.querySelectorAll("label") ?? []).map(
        (l) => l.textContent,
      );
      // The reason is a help line of the row: the button's effect hands it up, and the row shows it
      // one render after the title box is there.
      await waitFor(() => expect(inside.queryByText(names.reason)).not.toBeNull());
      const create = inside.queryByRole("button", { name: names.create });
      const reason = inside.queryByText(names.reason);
      expect([
        names.labels.every((label) => visible.includes(label)),
        create?.hasAttribute("disabled") ?? null,
        reason !== null && create?.getAttribute("aria-describedby") === reason.id,
      ]).toEqual([true, true, true]);
      fireEvent.change(inside.getByRole("textbox", { name: names.labels[1] }), {
        target: { value: "Use the queue" },
      });
      await waitFor(() => expect(inside.queryByText(names.reason) === null).toBe(true));
      expect(create?.hasAttribute("disabled")).toBe(false);
    });
  }
});
