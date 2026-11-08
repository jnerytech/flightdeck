import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { demoToast } = await import("../src/demo/boot.ts");
const { Composer } = await import("../src/components/session/parts.tsx");

const CSS = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
  document.documentElement.style.removeProperty("--update-card-lift");
  document.documentElement.style.removeProperty("--composer-clear");
});

/** A store whose updater finds and downloads `available` (the update card then shows). */
function setup(lang: "en" | "pt-BR", available: string | null) {
  const mem = memoryPlatform(false, lang);
  const nothing = async () => {};
  mem.platform.updater = {
    supported: true,
    check: async () => (available ? { version: available, notes: "" } : null),
    download: nothing,
    install: nothing,
    installDownloaded: nothing,
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  return store;
}

const toaster = () => document.querySelector<HTMLElement>("[data-sonner-toaster]");

describe("toast-gap: the toasts sit clear of the status bar and of the update card (issue #581)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: the toasts take their bottom offset from the corner's variable, on a phone too`, async () => {
      const store = setup(lang, null);
      render(<App store={store} />);
      await act(async () => {
        store.success("Saved");
      });
      await settle(() => toaster() !== null);
      const style = toaster()?.style;
      expect(style?.getPropertyValue("--offset-bottom")).toBe("var(--toast-bottom)");
      expect(style?.getPropertyValue("--offset-right")).toBe("0.75rem");
      expect(style?.getPropertyValue("--mobile-offset-bottom")).toBe("var(--toast-bottom)");
    });
  }

  test("the corner's offset is one variable: over the status bar with the card's gap, sonner's own without a bar, lifted over the update card", () => {
    expect(CSS).toContain("--corner-bottom: calc(var(--status-bar-height) + 0.75rem);");
    expect(CSS).toContain('html:not(:has([data-slot="status-bar"])) {\n  --corner-bottom: 24px;');
    expect(CSS).toContain(
      "--toast-bottom: max(calc(var(--corner-bottom) + var(--update-card-lift, 0px)), var(--composer-clear, 0px));",
    );
    expect(CSS).toContain("bottom: var(--corner-bottom);");
    expect(CSS).not.toContain("bottom: calc(var(--status-bar-height, 0rem) + 0.75rem);");
  });

  test("while the update card shows, it lifts the toasts by its height and the gap; closed, it lifts them no more", async () => {
    const store = setup("en", "9.9.9");
    render(<App store={store} />);
    const lift = () => document.documentElement.style.getPropertyValue("--update-card-lift");
    await settle(() => screen.queryByRole("region", { name: "Update available" }) !== null);
    expect(lift()).toMatch(/^calc\(\d+px \+ 0\.75rem\)$/);
    await act(async () => {
      fireEvent.click(
        screen.queryByRole("button", { name: "Close the update notice" }) as HTMLElement,
      );
    });
    await settle(() => screen.queryByRole("region", { name: "Update available" }) === null);
    expect(lift()).toBe("");
  });

  // #994: on a session page the corner is the message box: a toast covered Send, and on a phone the
  // whole box and the mode chip. While a message box shows, the toasts sit above it.
  test("while a message box shows, it lifts the toasts above its top; with two, above the higher; gone, no more", async () => {
    const clear = () => document.documentElement.style.getPropertyValue("--composer-clear");
    const both = render(
      <>
        <Composer>one</Composer>
        <Composer>two</Composer>
      </>,
    );
    expect(clear()).toMatch(/^calc\(\d+px \+ 0\.75rem\)$/);
    both.unmount();
    expect(clear()).toBe("");
    const one = render(<Composer>one</Composer>);
    expect(clear()).toMatch(/^calc\(\d+px \+ 0\.75rem\)$/);
    one.unmount();
    expect(clear()).toBe("");
  });

  test("in the demo, the prints' event shows one toast in the page's language, each time it is sent", () => {
    const shown: string[] = [];
    const store = {
      success: (text: string) => shown.push(text),
      i18n: {
        t: (key: string, params?: Record<string, string>) => `${key} ${JSON.stringify(params)}`,
      },
    };
    const page = new EventTarget();
    const stop = demoToast(store, page);
    expect(shown).toEqual([]);
    page.dispatchEvent(new Event("flightdeck:demo-toast"));
    expect(shown).toEqual(['toast.rootAdded {"folder":"~/projetos/loja","host":"alfa"}']);
    stop();
    page.dispatchEvent(new Event("flightdeck:demo-toast"));
    expect(shown).toHaveLength(1);
  });
});
