import { describe, expect, test } from "bun:test";
import type { HostView } from "../../src/lib/app-store.ts";
import type { Route } from "../../src/lib/router.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { AppStore } = await import("../../src/lib/app-store.ts");
const { breadcrumb } = await import("../../src/features/shell/domain/crumbs.ts");

/**
 * Issue #3951: two terminals of a host were both "Terminal". A terminal whose folder is known is
 * named after it in the header's path; the host is already the step before it.
 */

const host = (id: string, name: string) => ({ id, name }) as HostView;
const terminal: Route = { name: "terminal", host: "h1", terminalId: "t1" };

function steps(lang: "en" | "pt-BR", route: Route, terminalCwds: Record<string, string>) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = {
    ...store.getState(),
    hosts: [host("h1", "alpha"), host("h2", "beta")],
    terminalCwds,
  };
  return breadcrumb(route, state, store.i18n.t).map((step) => step.label);
}

describe("terminal-crumb: a terminal is named after its folder (issue #3951)", () => {
  test("the last step is the last segment of the folder, after the host, in both languages", () => {
    const cwds = { "h1/t1": "/work/api" };
    expect(steps("en", terminal, cwds)).toEqual(["alpha", "api"]);
    expect(steps("pt-BR", terminal, cwds)).toEqual(["alpha", "api"]);
  });

  test("the same terminal id on another host keeps its own folder", () => {
    const cwds = { "h1/t1": "/work/api", "h2/t1": "/srv/web" };
    expect(steps("en", { name: "terminal", host: "h2", terminalId: "t1" }, cwds)).toEqual([
      "beta",
      "web",
    ]);
  });

  test("a folder with a trailing slash still gives its name", () => {
    expect(steps("en", terminal, { "h1/t1": "/work/api/" })).toEqual(["alpha", "api"]);
  });

  test("a terminal whose folder is not known is still Terminal", () => {
    expect(steps("en", terminal, {})).toEqual(["alpha", "Terminal"]);
    expect(steps("pt-BR", terminal, {})).toEqual(["alpha", "Terminal"]);
  });
});
