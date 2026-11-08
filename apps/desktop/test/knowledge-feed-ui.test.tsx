import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { KnowledgeFeedState } from "@flightdeck/protocol";
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

/** Issue #76, slice 4: the switch for the documents index, in the project's knowledge panel. */
const ON: KnowledgeFeedState = { on: true, trusted: true, offBy: null };
const OFF: KnowledgeFeedState = { on: false, trusted: true, offBy: "/work/api" };

function setup(
  options: {
    language?: "en" | "pt-BR";
    features?: string[];
    state?: KnowledgeFeedState | null;
    afterSet?: KnowledgeFeedState | null;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "knowledge.list") return { entries: [], truncated: false };
    if (type === "knowledge.feed") return "state" in options ? options.state : ON;
    if (type === "knowledge.setFeed") return "afterSet" in options ? options.afterSet : OFF;
    return null;
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
          features: options.features ?? ["knowledge", "knowledgeFeed"],
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
const switchedOn =
  "Sessions that Flightdeck starts here are given an index of the valid documents.";

describe("knowledge-feed-ui: whether agents are given the index (#76)", () => {
  test("a project with the index on says so and offers to turn it off, asking the host for the state", async () => {
    const { view, sent } = setup();
    render(view);
    await waitFor(() => expect(within(panel()).queryByText(switchedOn)).not.toBeNull());
    expect([
      within(panel()).queryByRole("button", { name: "Turn off" }) !== null,
      within(panel()).queryByRole("button", { name: "Turn on" }) !== null,
      sent.filter(([type]) => type === "knowledge.feed"),
    ]).toEqual([true, false, [["knowledge.feed", { path: "/work/api" }]]]);
  });

  test("turning it off asks the host for that project only, and shows the answer", async () => {
    const { view, sent } = setup();
    render(view);
    await waitFor(() =>
      expect(within(panel()).queryByRole("button", { name: "Turn off" })).not.toBeNull(),
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(within(panel()).queryByRole("button", { name: "Turn on" })).not.toBeNull(),
    );
    expect([
      sent.filter(([type]) => type === "knowledge.setFeed"),
      within(panel()).queryByText("Off: sessions here are not given the index.") !== null,
    ]).toEqual([[["knowledge.setFeed", { path: "/work/api", enabled: false }]], true]);
  });

  test("a project off through a folder above it names the folder and offers no switch", async () => {
    render(setup({ state: { on: false, trusted: true, offBy: "/work" } }).view);
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "Off through /work, a folder above this project, in the host's config. Switch it on there.",
        ),
      ).not.toBeNull(),
    );
    expect(within(panel()).queryAllByRole("button", { name: /^Turn (on|off)$/ })).toHaveLength(0);
  });

  test("an untrusted project says it is not given the index even when the switch is on", async () => {
    render(setup({ state: { on: true, trusted: false, offBy: null } }).view);
    await waitFor(() =>
      expect(
        within(panel()).queryByText(
          "On, but this project is not trusted, so sessions are not given the index.",
        ),
      ).not.toBeNull(),
    );
    expect(within(panel()).queryByRole("button", { name: "Turn off" })).not.toBeNull();
  });

  test("a host that cannot read or change it says so, and the button stays", async () => {
    const { view } = setup({ afterSet: null });
    render(view);
    await waitFor(() =>
      expect(within(panel()).queryByRole("button", { name: "Turn off" })).not.toBeNull(),
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(
        within(panel()).queryByText("The index switch could not be read or changed on this host."),
      ).not.toBeNull(),
    );
    expect(within(panel()).queryByRole("button", { name: "Turn off" })).not.toBeNull();
    cleanup();
    render(setup({ state: null }).view);
    await waitFor(() =>
      expect(
        within(panel()).queryByText("The index switch could not be read or changed on this host."),
      ).not.toBeNull(),
    );
  });

  test("a host that does not announce knowledgeFeed shows no switch and is not asked", async () => {
    const { view, sent } = setup({ features: ["knowledge"] });
    render(view);
    await waitFor(() => expect(sent.some(([type]) => type === "knowledge.list")).toBe(true));
    expect([
      within(panel()).queryByRole("button", { name: /^Turn (on|off)$/ }) !== null,
      sent.some(([type]) => type === "knowledge.feed"),
    ]).toEqual([false, false]);
  });

  test("the switch is written in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }).view);
    const region = await screen.findByRole("region", { name: "Conhecimento do projeto" });
    await waitFor(() =>
      expect(
        within(region).queryByText(
          "As sessões que o Flightdeck inicia aqui recebem um índice dos documentos válidos.",
        ),
      ).not.toBeNull(),
    );
    expect(within(region).queryByRole("button", { name: "Desligar" })).not.toBeNull();
  });
});
