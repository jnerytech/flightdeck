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

/** Issue #76, slice 2: the project's library of documents on its page, with the status of each. */
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
  ...over,
});

const LIST = {
  truncated: false,
  entries: [
    entry("docs/adr/0003-new.md", {
      title: "Use the outbox",
      warnings: ["references_obsolete:docs/adr/0001-old.md"],
    }),
    entry("docs/adr/0002-moving.md", { title: "Move to queues", status: "transitional" }),
    entry("docs/adr/0001-old.md", { title: "Poll the table", status: "obsolete" }),
    entry("docs/decisions/2026-01-01-x.md", {
      title: "Old decision",
      status: "unclassified",
      problems: ["status_unknown"],
    }),
  ],
};

function setup(options: { language?: "en" | "pt-BR"; features?: string[]; list?: unknown } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "knowledge.list") return "list" in options ? options.list : LIST;
    return null;
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: options.features ?? ["knowledge"] },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = <ProjectPage store={store} state={state} hostId="h1" projectId="p1" go={() => {}} />;
  return { view, sent };
}

const panel = () => screen.getByRole("region", { name: "Project knowledge" });

describe("knowledge-panel-ui: the library of a project on its page (#76)", () => {
  test("each document shows its title, path, type and status in words, and the filters count them", async () => {
    const { view, sent } = setup();
    render(view);
    await waitFor(() => expect(screen.queryByText("Use the outbox")).not.toBeNull());
    const text = panel().textContent ?? "";
    expect([
      sent.filter(([type]) => type === "knowledge.list"),
      [
        "Use the outbox",
        "docs/adr/0003-new.md",
        "Valid",
        "Transitional",
        "Obsolete",
        "Not classified",
      ].map((word) => text.includes(word)),
      ["All (4)", "Valid (1)", "Transitional (1)", "Obsolete (1)", "Not classified (1)"].map(
        (name) => within(panel()).queryByRole("button", { name }) !== null,
      ),
    ]).toEqual([
      [["knowledge.list", { path: "/work/api" }]],
      [true, true, true, true, true, true],
      [true, true, true, true, true],
    ]);
  });

  test("a filter shows only the documents of that status, and says which one is pressed", async () => {
    render(setup().view);
    await waitFor(() => expect(screen.queryByText("Use the outbox")).not.toBeNull());
    fireEvent.click(within(panel()).getByRole("button", { name: "Obsolete (1)" }));
    const text = panel().textContent ?? "";
    expect([
      text.includes("Poll the table"),
      text.includes("Use the outbox"),
      within(panel()).getByRole("button", { name: "Obsolete (1)" }).getAttribute("aria-pressed"),
      within(panel()).getByRole("button", { name: "All (4)" }).getAttribute("aria-pressed"),
    ]).toEqual([true, false, "true", "false"]);
  });

  test("a warning and a problem are written out, not only coloured", async () => {
    render(setup().view);
    await waitFor(() => expect(screen.queryByText("Use the outbox")).not.toBeNull());
    const text = panel().textContent ?? "";
    expect([
      text.includes("Points at an obsolete document: docs/adr/0001-old.md"),
      text.includes(
        "The status in the front matter is not valid, so agents are not given this document.",
      ),
    ]).toEqual([true, true]);
  });

  test("an empty library says where documents are looked for, and a cut list says so", async () => {
    render(setup({ list: { entries: [], truncated: false } }).view);
    await waitFor(() =>
      expect(
        screen.queryByText(
          "No documents in docs/decisions, docs/adr, docs/rfc, docs/prd or docs/specs.",
        ),
      ).not.toBeNull(),
    );
    cleanup();
    render(setup({ list: { entries: [entry("docs/adr/a.md")], truncated: true } }).view);
    await waitFor(() =>
      expect(
        screen.queryByText("The list is cut: only the first documents are shown."),
      ).not.toBeNull(),
    );
  });

  test("a host without the feature shows nothing, and a refused list says so", async () => {
    const without = setup({ features: [] });
    render(without.view);
    expect([
      screen.queryByRole("region", { name: "Project knowledge" }),
      without.sent.some(([type]) => type === "knowledge.list"),
    ]).toEqual([null, false]);
    cleanup();
    render(setup({ list: null }).view);
    await waitFor(() =>
      expect(screen.queryByText("The documents could not be read from this host.")).not.toBeNull(),
    );
  });

  test("the statuses and the title come in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }).view);
    await waitFor(() => expect(screen.queryByText("Use the outbox")).not.toBeNull());
    const region = screen.getByRole("region", { name: "Conhecimento do projeto" });
    const text = region.textContent ?? "";
    expect(
      ["Válido", "Em transição", "Obsoleto", "Sem classificação"].map((w) => text.includes(w)),
    ).toEqual([true, true, true, true]);
  });
});
