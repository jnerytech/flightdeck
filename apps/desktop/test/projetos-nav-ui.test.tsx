import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

async function mount(language = "en") {
  // One host that never answers: with no host at all the app shows the add-host form instead.
  const mem = memoryPlatform(false, language);
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {});
  const item = (name: RegExp) => screen.queryByRole("button", { name }) as HTMLElement;
  const names = () => store.tabs.tabs.map((tab) => tab.router.current.name);
  return { store, item, names };
}

describe("projetos-nav-ui: the Projects item of the sidebar", () => {
  test("it sits between Needs you and Board and opens the overview", async () => {
    const { store, item, names } = await mount();
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const at = (label: RegExp) => labels.findIndex((l) => label.test(l));
    expect(at(/^Projects/)).toBeGreaterThan(at(/^Needs you/));
    expect(at(/^Projects/)).toBeLessThan(at(/^Board/));
    await act(async () => void fireEvent.click(item(/^Projects/)));
    expect(names()).toEqual(["all-projects"]);
    expect(screen.queryByRole("heading", { name: "Projects" })).not.toBeNull();
    expect(screen.queryByText("No projects yet.")).not.toBeNull();
    store.dispose();
  });

  test("the item is marked when the overview or a project page is open", async () => {
    const { store, item } = await mount();
    await act(async () => void fireEvent.click(item(/^Projects/)));
    expect(item(/^Projects/).getAttribute("aria-current")).toBe("page");
    await act(async () => {
      store.tabs.active.router.push({ name: "project", host: "h1", projectId: "p1" });
    });
    expect(item(/^Projects/).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("This project is not on this host.")).not.toBeNull();
    store.dispose();
  });

  test("in Portuguese it is Projetos", async () => {
    const { store, item, names } = await mount("pt-BR");
    await act(async () => void fireEvent.click(item(/^Projetos/)));
    expect(names()).toEqual(["all-projects"]);
    store.dispose();
  });
});
