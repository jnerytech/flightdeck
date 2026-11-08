import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
    expect(CSS.replace(/\s+/g, " ")).toContain(
      "--toast-bottom: max( calc(var(--corner-bottom) + var(--update-card-lift, 0px)), var(--composer-clear, 0px) );",
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
  // whole box and the mode chip. While a message box shows, the toasts sit above it. happy-dom has
  // no layout: each box's top comes from its wrapper's data-top, and a box under [hidden] (another
  // tab of the session) has no box at all, as in a browser.
  describe("the message box lifts the toasts (#994)", () => {
    const clear = () => document.documentElement.style.getPropertyValue("--composer-clear");
    const lifted = (top: number) =>
      `calc(${(document.defaultView?.innerHeight ?? 0) - top}px + 0.75rem)`;
    // The boxes and their wrappers are divs: the stub goes on the div's own prototype, the nearest
    // one, so nothing between it and the element (as another file of the full run may leave on
    // HTMLElement's) shadows it. The exact descriptors come back after each test.
    let proto: HTMLDivElement;
    const kept = new Map<string, PropertyDescriptor | undefined>();
    const RealObserver = globalThis.ResizeObserver;
    const observers: Array<{ fire(target: Element): void }> = [];
    beforeEach(() => {
      proto = Object.getPrototypeOf(document.createElement("div"));
      for (const name of ["getBoundingClientRect", "getClientRects"]) {
        kept.set(name, Object.getOwnPropertyDescriptor(proto, name));
      }
      proto.getBoundingClientRect = function (this: HTMLElement) {
        const top = Number(this.closest("[data-top]")?.getAttribute("data-top") ?? 0);
        return {
          top,
          bottom: top + 100,
          left: 0,
          right: 100,
          width: 100,
          height: 100,
          x: 0,
          y: top,
        } as DOMRect;
      };
      proto.getClientRects = function (this: HTMLElement) {
        return (this.closest("[hidden]")
          ? []
          : [this.getBoundingClientRect()]) as unknown as DOMRectList;
      };
      globalThis.ResizeObserver = class {
        private readonly targets: Element[] = [];
        constructor(private readonly callback: ResizeObserverCallback) {
          observers.push({
            fire: (target) => this.targets.includes(target) && this.callback([], this as never),
          });
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        unobserve() {}
        disconnect() {
          this.targets.length = 0;
        }
      } as unknown as typeof ResizeObserver;
    });
    afterEach(() => {
      for (const [name, descriptor] of kept) {
        if (descriptor) Object.defineProperty(proto, name, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[name];
      }
      globalThis.ResizeObserver = RealObserver;
      observers.length = 0;
    });

    test("with two boxes the toasts clear the higher one; gone, no more", () => {
      const view = render(
        <>
          <div data-top="500">
            <Composer>one</Composer>
          </div>
          <div data-top="400">
            <Composer>two</Composer>
          </div>
        </>,
      );
      expect(clear()).toBe(lifted(400));
      view.unmount();
      expect(clear()).toBe("");
    });

    test("a box on a hidden tab lifts nothing, and lifts again once it shows", async () => {
      const view = (hidden: boolean) => (
        <div hidden={hidden} data-top="500">
          <Composer>one</Composer>
        </div>
      );
      const { rerender } = render(view(true));
      expect(clear()).toBe("");
      rerender(view(false));
      const box = document.querySelector('[data-slot="composer-card"]') as HTMLElement;
      for (const o of observers) o.fire(box);
      expect(clear()).toBe(lifted(500));
    });

    test("the box moving with the dock, or the window resizing, moves the lift", async () => {
      render(
        <div data-top="500">
          <Composer>one</Composer>
        </div>,
      );
      const box = document.querySelector('[data-slot="composer-card"]') as HTMLElement;
      const dock = box.parentElement as HTMLElement;
      dock.setAttribute("data-top", "420");
      for (const o of observers) o.fire(dock);
      expect(clear()).toBe(lifted(420));
      dock.setAttribute("data-top", "380");
      document.defaultView?.dispatchEvent(new Event("resize"));
      expect(clear()).toBe(lifted(380));
    });
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
