import { afterEach, describe, expect, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { StartScreen } = await import("../src/ui/StartScreen.tsx");

afterEach(cleanup);

const hosts = [
  {
    id: "h",
    name: "pc",
    status: "online",
    sessions: [
      { id: "a", cwd: "/p/alpha", status: "idle", updatedAt: "2026-11-03T10:00:00Z" },
      { id: "b", cwd: "/p/beta", name: "Beta", status: "idle", updatedAt: "2026-11-03T11:00:00Z" },
    ],
  },
] as never;

function show(list: never) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  const routes: Route[] = [];
  render(<StartScreen store={store} hosts={list} go={(route) => routes.push(route)} />);
  return routes;
}

describe("inicio-tela: the start screen of an empty area", () => {
  test("it starts a session on the first online host and opens the lists", async () => {
    const routes = show(hosts);
    for (const name of ["Nova sessão", "Sessões", "Precisa de você"]) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name }));
      });
    }
    expect(routes).toEqual([
      { name: "new-session", host: "h" },
      { name: "hub" },
      { name: "needs-you" },
    ]);
  });

  test("it lists the latest sessions first, opens one and prints the shortcuts", async () => {
    const routes = show(hosts);
    const recent = screen.getByRole("list", { name: "Sessões recentes" });
    expect(
      within(recent)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Beta", "alpha"]);
    await act(async () => {
      fireEvent.click(within(recent).getByRole("button", { name: "Beta" }));
    });
    expect(routes).toEqual([{ name: "session", host: "h", id: "b" }]);
    expect(
      within(screen.getByRole("list", { name: "Atalhos" })).getAllByRole("listitem"),
    ).toHaveLength(4);
  });

  test("with no host online there is no new-session button and no recent list", () => {
    show([] as never);
    expect(screen.queryByRole("button", { name: "Nova sessão" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Sessões recentes" })).toBeNull();
  });
});
