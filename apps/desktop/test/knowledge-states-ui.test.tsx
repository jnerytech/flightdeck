import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { KnowledgeEntry, KnowledgeFeedState } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Issue #1091: what the knowledge panel says while it loads, when it cannot read, and for its switch. */
const DOC = {
  path: "docs/adr/0001-queue.md",
  title: "Use a queue",
  type: "adr",
  status: "valid",
  supersedes: null,
  bytes: 10,
  changedAt: "2026-11-05T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: "h",
} as KnowledgeEntry;
const LIST = { truncated: false, entries: [DOC] };
const ON: KnowledgeFeedState = { on: true, trusted: true, offBy: null, own: false };

type Setup = {
  language?: "en" | "pt-BR";
  /** What each read of the list answers; the last one repeats. */
  lists?: Array<() => Promise<unknown>>;
  afterSet?: KnowledgeFeedState | null;
};

function setup(options: Setup = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  let reads = 0;
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "knowledge.list") {
      const lists = options.lists ?? [async () => LIST];
      return lists[Math.min(reads++, lists.length - 1)]?.();
    }
    if (type === "knowledge.feed") return ON;
    if (type === "knowledge.setFeed") return "afterSet" in options ? options.afterSet : null;
    return null;
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: ["knowledge", "knowledgeFeed"] },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = <ProjectPage store={store} state={state} hostId="h1" projectId="p1" go={() => {}} />;
  return { view, sent };
}

const panel = (name = "Project knowledge") => screen.queryByRole("region", { name });
const inPanel = (name?: string) => within((panel(name) ?? document.body) as HTMLElement);

describe("knowledge-states-ui: loading and a list that cannot be read (#1091)", () => {
  test("while the list loads, the panel says it is loading instead of showing nothing", async () => {
    render(setup({ lists: [() => new Promise(() => {})] }).view);
    const shown = await settleMaybe(() => panel() !== null);
    expect(shown).toBe(true);
    expect(inPanel().queryByRole("status", { name: "Loading documents" }) === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a list that cannot be read says what to check and offers Try again, which reads it again", async () => {
    const { view, sent } = setup({ lists: [async () => null, async () => LIST] });
    render(view);
    const said = await settleMaybe(
      () => inPanel().queryByText("The documents could not be read from this host.") !== null,
    );
    expect(said).toBe(true);
    const absent =
      inPanel().queryByText(
        "Check that the host is online and that the project's folder still exists, then try again.",
      ) === null;
    expect(absent).toBe(false);
    expect(inPanel().queryByRole("alert") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    const retry = inPanel().queryByRole("button", { name: "Try again" });
    expect(retry === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await act(async () => {
      fireEvent.click(retry as HTMLElement);
    });
    expect(await settleMaybe(() => inPanel().queryByText("Use a queue") !== null)).toBe(true);
    expect(sent.filter(([type]) => type === "knowledge.list")).toHaveLength(2);
  });

  test("after Try again the focus is not lost: on the button when it fails again, in the panel when it works", async () => {
    const { view } = setup({ lists: [async () => null, async () => null, async () => LIST] });
    render(view);
    await settleMaybe(() => inPanel().queryByRole("button", { name: "Try again" }) !== null);
    const inside = () =>
      document.activeElement !== document.body &&
      Boolean(panel()?.contains(document.activeElement));
    await act(async () => {
      fireEvent.click(inPanel().getByRole("button", { name: "Try again" }));
    });
    // Failed again: the button is still there and has the focus.
    expect(
      await settleMaybe(
        () => document.activeElement === inPanel().queryByRole("button", { name: "Try again" }),
      ),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(inPanel().getByRole("button", { name: "Try again" }));
    });
    expect(await settleMaybe(() => inPanel().queryByText("Use a queue") !== null)).toBe(true);
    expect(await settleMaybe(inside)).toBe(true);
  });

  test("the hint is part of the alert, so it is read with it", async () => {
    render(setup({ lists: [async () => null] }).view);
    await settleMaybe(() => inPanel().queryByRole("alert") !== null);
    expect(Boolean(inPanel().queryByRole("alert")?.textContent?.includes("then try again."))).toBe(
      true,
    );
  });

  test("in Portuguese the loading line is in Portuguese", async () => {
    render(setup({ language: "pt-BR", lists: [() => new Promise(() => {})] }).view);
    await settleMaybe(() => panel("Conhecimento do projeto") !== null);
    const absent2 =
      inPanel("Conhecimento do projeto").queryByRole("status", {
        name: "Carregando os documentos",
      }) === null;
    expect(absent2).toBe(false);
  });

  test("in Portuguese the hint and Try again are in Portuguese", async () => {
    render(setup({ language: "pt-BR", lists: [async () => null] }).view);
    const said = await settleMaybe(
      () =>
        inPanel("Conhecimento do projeto").queryByRole("button", { name: "Tentar de novo" }) !==
        null,
    );
    expect(said).toBe(true);
    const absent3 =
      inPanel("Conhecimento do projeto").queryByText(
        "Confira se o host está online e se a pasta do projeto ainda existe, e tente de novo.",
      ) === null;
    expect(absent3).toBe(false);
  });
});

describe("knowledge-states-ui: the index switch says what happened (#1091)", () => {
  const switchedOn =
    "Sessions that Flightdeck starts here are given an index of the valid documents.";

  test("the switch's words are a live region, so turning it on or off is announced", async () => {
    render(setup().view);
    await settleMaybe(() => inPanel().queryByText(switchedOn) !== null);
    expect(
      inPanel()
        .queryAllByRole("status")
        .some((live) => live.textContent === switchedOn),
    ).toBe(true);
  });

  test("a switch the host could not change is an alert", async () => {
    render(setup({ afterSet: null }).view);
    await settleMaybe(() => inPanel().queryByRole("button", { name: "Turn off" }) !== null);
    await act(async () => {
      fireEvent.click(inPanel().getByRole("button", { name: "Turn off" }));
    });
    const failed = "The index switch could not be read or changed on this host.";
    expect(await settleMaybe(() => inPanel().queryByText(failed) !== null)).toBe(true);
    expect(inPanel().queryByText(failed)?.getAttribute("role")).toBe("alert");
  });
});
