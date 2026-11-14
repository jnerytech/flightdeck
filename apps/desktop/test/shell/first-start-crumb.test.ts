import { describe, expect, test } from "bun:test";
import type { HostView } from "../../src/lib/app-store.ts";
import type { Route } from "../../src/lib/router.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { AppStore } = await import("../../src/lib/app-store.ts");
const { breadcrumb } = await import("../../src/features/shell/domain/crumbs.ts");

/**
 * Issue #1551: with no host the screen is "Connect your first host", so its tab and the header's
 * crumb (the tab's title is the crumb's last step) name it, not "Sessions".
 */

function last(lang: "en" | "pt-BR", route: Route, hosts: HostView[] = []) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = { ...store.getState(), hosts };
  return breadcrumb(route, state, store.i18n.t).map((step) => step.label);
}

describe("first-start-crumb: the first-start screen names itself (issue #1551)", () => {
  test("with no host, Sessions (the hub) reads Connect a host, in both languages", () => {
    expect(last("en", { name: "hub" })).toEqual(["Connect a host"]);
    expect(last("pt-BR", { name: "hub" })).toEqual(["Conectar um host"]);
  });

  test("any screen the first start replaces reads the same", () => {
    expect(last("en", { name: "overview" })).toEqual(["Connect a host"]);
    expect(last("en", { name: "needs-you" })).toEqual(["Connect a host"]);
  });

  test("Settings, Add host and the start screen keep their own names with no host", () => {
    expect(last("en", { name: "settings" })).toEqual(["Settings"]);
    expect(last("en", { name: "add-host" })).toEqual(["Hosts", "Add host"]);
    expect(last("en", { name: "start" })).toEqual(["Sessions"]);
  });

  test("with a host, the hub is Sessions again", () => {
    const host = { id: "h1", name: "box" } as HostView;
    expect(last("en", { name: "hub" }, [host])).toEqual(["Sessions"]);
    expect(last("pt-BR", { name: "hub" }, [host])).toEqual(["Sessões"]);
  });
});
