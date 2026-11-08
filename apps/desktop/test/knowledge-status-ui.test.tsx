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

/** Issue #76, slice 5: a document's status changed from the knowledge panel. */
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

function setup(
  options: {
    language?: "en" | "pt-BR";
    features?: string[];
    answer?: Answer;
    list?: typeof LIST;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  // What the host's files say after a change that went through, so the list read again shows it.
  const applied = new Map<string, KnowledgeEntry["status"]>();
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type !== "knowledge.list") return null;
    const list = options.list ?? LIST;
    return {
      ...list,
      entries: list.entries.map((e) => ({ ...e, status: applied.get(e.path) ?? e.status })),
    };
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    const asked = payload as { file: string; status: KnowledgeEntry["status"] };
    if (options.answer === undefined) applied.set(asked.file, asked.status);
    return (
      options.answer ?? { ok: true, data: entry("docs/adr/0003-new.md", { status: "obsolete" }) }
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
          features: options.features ?? ["knowledge", "knowledgeStatus"],
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
const picker = (title: string) =>
  within(panel()).getByRole("combobox", { name: `Status of ${title}` }) as HTMLSelectElement;
const apply = (title: string) =>
  within(panel()).queryByRole("button", {
    name: `Change the status of ${title}`,
  }) as HTMLButtonElement | null;
/** Whether the Change button of a document is there and can be pressed. */
const canApply = (title: string) => apply(title)?.disabled === false;
const press = (title: string) => {
  const button = apply(title);
  expect(button).not.toBeNull();
  fireEvent.click(button as HTMLElement);
};
const listed = async () =>
  await waitFor(() => expect(within(panel()).queryByText("Use the outbox")).not.toBeNull());

describe("knowledge-status-ui: changing the status of a document (#76)", () => {
  test("each document has a picker with its status in words, and the panel says the file is edited, not committed", async () => {
    render(setup().view);
    await listed();
    expect([
      picker("Use the outbox").value,
      picker("Old decision").value,
      [...picker("Use the outbox").options].map((o) => o.textContent),
      within(panel()).queryByText(
        "Changing a status edits the document's file in this project's folder. Nothing is committed: review the change with git.",
      ) !== null,
    ]).toEqual(["valid", "", ["Valid", "Transitional", "Obsolete"], true]);
    expect([...picker("Old decision").options].map((o) => [o.textContent, o.disabled])).toEqual([
      ["Not classified", true],
      ["Valid", false],
      ["Transitional", false],
      ["Obsolete", false],
    ]);
  });

  test("choosing a status asks the host with the hash that was shown, says what changed, and reloads the list", async () => {
    const { view, sent } = setup();
    render(view);
    await listed();
    fireEvent.change(picker("Use the outbox"), { target: { value: "obsolete" } });
    press("Use the outbox");
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "Use the outbox is now Obsolete. The file is changed in the project's folder and not committed.",
        ),
      ).not.toBeNull(),
    );
    expect(sent.filter(([type]) => type === "knowledge.setStatus")).toEqual([
      [
        "knowledge.setStatus",
        {
          path: "/work/api",
          file: "docs/adr/0003-new.md",
          status: "obsolete",
          expectedHash: "hash-of-docs/adr/0003-new.md",
        },
      ],
    ]);
    expect(sent.filter(([type]) => type === "knowledge.list")).toHaveLength(2);
  });

  test("choosing alone writes nothing, however many choices an arrow key makes; the Change button writes once", async () => {
    const { view, sent } = setup();
    render(view);
    await listed();
    // Arrow keys on a closed select fire a change for each value they pass.
    for (const value of ["transitional", "obsolete", "transitional"]) {
      fireEvent.change(picker("Use the outbox"), { target: { value } });
    }
    expect(picker("Use the outbox").value).toBe("transitional");
    expect(sent.filter(([type]) => type === "knowledge.setStatus")).toEqual([]);
    press("Use the outbox");
    await waitFor(() =>
      expect(sent.filter(([type]) => type === "knowledge.setStatus")).toHaveLength(1),
    );
    const [[, written]] = sent.filter(([type]) => type === "knowledge.setStatus") as [
      [string, { status: string }],
    ];
    expect(written.status).toBe("transitional");
  });

  test("the Change button is off until the choice differs from the file's status, and a document that was not classified needs a choice", async () => {
    render(setup().view);
    await listed();
    expect([apply("Use the outbox")?.disabled, apply("Old decision")?.disabled]).toEqual([
      true,
      true,
    ]);
    fireEvent.change(picker("Use the outbox"), { target: { value: "obsolete" } });
    expect(canApply("Use the outbox")).toBe(true);
    fireEvent.change(picker("Use the outbox"), { target: { value: "valid" } });
    expect(canApply("Use the outbox")).toBe(false);
    fireEvent.change(picker("Old decision"), { target: { value: "valid" } });
    expect(canApply("Old decision")).toBe(true);
  });

  test("pressing Change twice at once writes once, and the focus is on the picker afterwards", async () => {
    const { view, sent } = setup();
    render(view);
    await listed();
    fireEvent.change(picker("Use the outbox"), { target: { value: "obsolete" } });
    // A double click or a held Enter: the second press comes before the host answers the first.
    press("Use the outbox");
    press("Use the outbox");
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "Use the outbox is now Obsolete. The file is changed in the project's folder and not committed.",
        ),
      ).not.toBeNull(),
    );
    expect(sent.filter(([type]) => type === "knowledge.setStatus")).toHaveLength(1);
    await waitFor(() => expect(document.activeElement === picker("Use the outbox")).toBe(true)); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    // The list read again says Obsolete, so there is nothing left to change.
    await waitFor(() => expect(picker("Use the outbox").value).toBe("obsolete"));
    expect(canApply("Use the outbox")).toBe(false);
  });

  test("a refused change keeps the choice, so Change can be pressed again", async () => {
    const { view } = setup({
      answer: {
        ok: false,
        code: "file_conflict",
        message: "changed",
        reason: "review_file_changed",
      },
    });
    render(view);
    await listed();
    fireEvent.change(picker("Use the outbox"), { target: { value: "transitional" } });
    press("Use the outbox");
    await waitFor(() => expect(within(panel()).queryByRole("alert")).not.toBeNull());
    expect([picker("Use the outbox").value, canApply("Use the outbox")]).toEqual([
      "transitional",
      true,
    ]);
  });

  test("the button says Change in words, in both languages", async () => {
    render(setup().view);
    await listed();
    expect(apply("Use the outbox")?.textContent).toBe("Change");
  });

  test("a refusal is written out in words, and the list is read again so the next try has the new hash", async () => {
    const { view, sent } = setup({
      answer: {
        ok: false,
        code: "file_conflict",
        message: "changed",
        reason: "review_file_changed",
        params: { path: "docs/adr/0003-new.md" },
      },
    });
    render(view);
    await listed();
    fireEvent.change(picker("Use the outbox"), { target: { value: "transitional" } });
    press("Use the outbox");
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "The status could not be changed. The file docs/adr/0003-new.md changed since it was opened: reload it and apply your edit again.",
        ),
      ).not.toBeNull(),
    );
    expect(sent.filter(([type]) => type === "knowledge.list")).toHaveLength(2);
  });

  test("a host that does not announce knowledgeStatus shows no picker and no note", async () => {
    render(setup({ features: ["knowledge"] }).view);
    await listed();
    expect([
      within(panel()).queryAllByRole("combobox").length,
      (panel().textContent ?? "").includes("Nothing is committed"),
    ]).toEqual([0, false]);
  });

  test("the picker is written in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }).view);
    const region = await screen.findByRole("region", { name: "Conhecimento do projeto" });
    await waitFor(() =>
      expect(
        within(region).queryByRole("combobox", { name: "Status de Use the outbox" }),
      ).not.toBeNull(),
    );
    const select = within(region).getByRole("combobox", {
      name: "Status de Old decision",
    }) as HTMLSelectElement;
    expect(
      within(region).queryByRole("button", { name: "Alterar o status de Old decision" }),
    ).not.toBeNull();
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Sem classificação",
      "Válido",
      "Em transição",
      "Obsoleto",
    ]);
  });
});

// #1050: the panel changes a document's file (its status), so it does not call itself read-only; and
// with no document there is no status to change, so the panel does not explain how changing one works.
describe("knowledge-status-ui: what the panel says it does (#1050)", () => {
  for (const [language, title, hint, setHint, empty] of [
    [
      "en",
      "Project knowledge",
      "The project's PRDs, RFCs, ADRs and specs, with the status each one says it has in its front matter.",
      "Changing a status edits the document's file in this project's folder. Nothing is committed: review the change with git.",
      "No documents in docs/decisions, docs/adr, docs/rfc, docs/prd or docs/specs.",
    ],
    [
      "pt-BR",
      "Conhecimento do projeto",
      "Os PRDs, RFCs, ADRs e specs do projeto, com o status que cada um diz ter no seu front matter.",
      "Mudar um status edita o arquivo do documento na pasta deste projeto. Nada é commitado: revise a mudança com o git.",
      "Nenhum documento em docs/decisions, docs/adr, docs/rfc, docs/prd ou docs/specs.",
    ],
  ] as const) {
    test(`${language}: the hint does not claim read-only, and with no document the status hint is gone`, async () => {
      render(setup({ language, list: { truncated: false, entries: [] } }).view);
      const region = () => screen.queryByRole("region", { name: title });
      await waitFor(() => expect(region()).not.toBeNull());
      const inside = within(region() as HTMLElement);
      await waitFor(() => expect(inside.queryByText(empty)).not.toBeNull());
      expect([inside.queryByText(hint) !== null, inside.queryByText(setHint) !== null]).toEqual([
        true,
        false,
      ]);
    });
  }
});

// #1105: where the status can be changed, a row read "Use the outbox [Valid] [Valid ▾]": the badge
// and the select said the same thing. The select alone shows it; the badge comes back only while
// another status is chosen and not yet written, to say what the file still says.
describe("knowledge-status-ui: the status shows once (#1105)", () => {
  const row = (title: string) => within(panel()).queryByText(title)?.closest("li") ?? null;
  const badges = (title: string) =>
    Array.from(row(title)?.querySelectorAll('[data-slot="badge"]') ?? []).map((b) => b.textContent);

  test("at rest the select alone shows the status; a pending choice brings back the file's own as a badge", async () => {
    render(setup().view);
    await listed();
    const atRest = badges("Use the outbox");
    fireEvent.change(picker("Use the outbox"), { target: { value: "obsolete" } });
    const pending = badges("Use the outbox");
    // After the select and Change, so the select does not move under the pointer; it says it is
    // the file's status, not a second choice.
    const afterChange = apply("Use the outbox")?.nextElementSibling?.textContent;
    fireEvent.change(picker("Use the outbox"), { target: { value: "valid" } });
    expect([atRest, pending, afterChange, badges("Use the outbox")]).toEqual([
      [],
      ["In the file: Valid"],
      "In the file: Valid",
      [],
    ]);
  });

  test("where the status cannot be changed, the badge shows it", async () => {
    render(setup({ features: ["knowledge"] }).view);
    await listed();
    expect(badges("Use the outbox")).toEqual(["Valid"]);
  });
});
