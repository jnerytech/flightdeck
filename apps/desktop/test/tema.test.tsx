import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "../src/lib/contrast.ts";
import { THEME_KEY, ThemeController, type ThemeEnv } from "../src/lib/theme.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { tauriPlatform } = await import("../src/platform/tauri/index.ts");

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

const DESKTOP = resolve(import.meta.dir, "..");

/** `--name: value;` declarations of the first `selector { … }` block of styles.css. */
function tokens(selector: string): Record<string, string> {
  const css = readFileSync(resolve(DESKTOP, "src/styles.css"), "utf8");
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

/** A system theme driven by hand, and the root element's classes. */
function fakeEnv(dark = false) {
  const listeners = new Set<() => void>();
  const classes = new Set<string>();
  const media = {
    matches: dark,
    addEventListener: (_: "change", fn: () => void) => listeners.add(fn),
    removeEventListener: (_: "change", fn: () => void) => listeners.delete(fn),
  };
  const env: ThemeEnv = {
    root: {
      classList: { toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)) },
    },
    matchMedia: () => media,
  };
  const system = (isDark: boolean) => {
    media.matches = isDark;
    for (const fn of listeners) fn();
  };
  return { env, classes, listeners, system };
}

function themePlatform() {
  const mem = memoryPlatform();
  const window: Array<"light" | "dark" | null> = [];
  mem.platform.setWindowTheme = async (theme) => {
    window.push(theme);
  };
  return { mem, window };
}

describe("tema", () => {
  test("contraste AA: texto e cores de estado sobre o fundo, nos dois temas", () => {
    expect(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 1);
    expect(contrastRatio("oklch(0.5 0 0)", "oklch(0.5 0 0)")).toBeCloseTo(1, 5);
    for (const selector of [":root", ".dark"]) {
      const t = tokens(selector);
      const background = t["--background"] ?? "";
      for (const name of [
        "--foreground",
        "--muted-foreground",
        "--status-running",
        "--status-needs-you",
        "--status-idle",
        "--status-ended",
        "--status-error",
        "--status-risk",
      ]) {
        const ratio = contrastRatio(t[name] ?? "", background);
        expect(`${selector} ${name} AA: ${ratio >= 4.5}`).toBe(`${selector} ${name} AA: true`);
      }
    }
  });

  test("Sistema é o padrão e segue a mudança do sistema ao vivo; Claro e Escuro fixam e ficam guardados", () => {
    const { mem, window } = themePlatform();
    const fake = fakeEnv(false);
    const theme = new ThemeController(mem.platform, fake.env);
    let changes = 0;
    theme.subscribe(() => changes++);
    theme.start();
    expect(theme.mode).toBe("system");
    expect(theme.resolved).toBe("light");
    expect(fake.classes.has("dark")).toBe(false);
    // The window follows the system by itself.
    expect(window).toEqual([null]);

    fake.system(true);
    expect(theme.resolved).toBe("dark");
    expect(fake.classes.has("dark")).toBe(true);
    expect(changes).toBe(1);

    theme.setMode("light");
    expect(fake.classes.has("dark")).toBe(false);
    expect(mem.items.get(THEME_KEY)).toBe("light");
    expect(window.at(-1)).toBe("light");
    // A fixed choice ignores the system.
    fake.system(false);
    fake.system(true);
    expect(theme.resolved).toBe("light");

    theme.setMode("dark");
    expect(fake.classes.has("dark")).toBe(true);
    expect(window.at(-1)).toBe("dark");
    theme.toggle();
    expect(theme.mode).toBe("light");
    expect(fake.classes.has("dark")).toBe(false);
    theme.stop();
    expect(fake.listeners.size).toBe(0);

    // Kept: a new start reads the stored choice.
    const again = new ThemeController(mem.platform, fakeEnv(true).env);
    again.start();
    expect(again.mode).toBe("light");
    expect(again.resolved).toBe("light");
  });

  test("Configurações e a paleta trocam o tema do app inteiro", async () => {
    const { mem } = themePlatform();
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => Bun.sleep(5));
    const settings = screen.queryByRole("button", { name: "Configurações" });
    expect(settings).not.toBeNull();
    await act(async () => {
      fireEvent.click(settings as HTMLElement);
    });
    const select = screen.queryByLabelText("Tema") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("system");
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      "Sistema",
      "Claro",
      "Escuro",
    ]);
    await act(async () => {
      fireEvent.change(select as HTMLSelectElement, { target: { value: "dark" } });
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mem.items.get(THEME_KEY)).toBe("dark");

    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      fireEvent.change(input as HTMLInputElement, { target: { value: "tema" } });
    });
    await act(async () => {
      fireEvent.keyDown(input as HTMLInputElement, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(store.theme.mode).toBe("light");
    store.dispose();
  });

  test("a janela do Tauri acompanha o tema, com a permissão na capability", async () => {
    const calls: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      calls.push([cmd, args]);
    }) as Parameters<typeof tauriPlatform>[1];
    const win = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { hasFocus: () => true },
      navigator: { clipboard: { writeText: async () => {} } },
    };
    await tauriPlatform(win, call).setWindowTheme("dark");
    await tauriPlatform(win, call).setWindowTheme(null);
    expect(calls).toEqual([
      ["plugin:window|set_theme", { label: "main", value: "dark" }],
      ["plugin:window|set_theme", { label: "main", value: null }],
    ]);
    const capability = JSON.parse(
      readFileSync(resolve(DESKTOP, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions: string[] };
    expect(capability.permissions).toContain("core:window:allow-set-theme");
  });
});
