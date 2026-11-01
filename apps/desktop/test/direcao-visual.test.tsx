import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { StatusDot } = await import("../src/components/status/status-dot.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

const DESKTOP = resolve(import.meta.dir, "..");
const css = readFileSync(resolve(DESKTOP, "src/styles.css"), "utf8");

/** The declarations inside the first `selector { … }` block of the stylesheet. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}

/** Lightness of an `oklch(L C H / a)` value. */
const lightness = (value: string | undefined) => Number(/oklch\(([\d.]+)/.exec(value ?? "")?.[1]);

describe("direcao-visual", () => {
  test("Inter embutida: pacote com versão fixa, woff2 local e nenhuma URL de rede", () => {
    const pkg = JSON.parse(readFileSync(resolve(DESKTOP, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@fontsource-variable/inter"] ?? "").toMatch(/^\d+\.\d+\.\d+$/);
    expect(css).toContain('@import "@fontsource-variable/inter"');
    // The file the import points at is really there (bundled by Vite, so no network).
    const file = Bun.resolveSync(
      "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      DESKTOP,
    );
    expect(file.endsWith(".woff2")).toBe(true);
    expect(css).not.toMatch(/https?:\/\//);
    expect(block("@theme inline")["--font-sans"]).toMatch(/^"Inter Variable"/);
    expect(block("@theme inline")["--font-mono"]).toMatch(/Cascadia Mono|Consolas/);
  });

  test("base de 13 px com a escala 12, 13, 14, 16, 20 e 24", () => {
    const theme = block("@theme inline");
    expect(
      ["--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl"].map(
        (k) => theme[k],
      ),
    ).toEqual(["12px", "13px", "14px", "16px", "20px", "24px"]);
    // The body is the 13 px step.
    expect(css).toMatch(/body\s*\{[^}]*text-sm/);
  });

  test("raio de 8 px nos controles e de 12 px nos painéis", () => {
    const theme = block("@theme inline");
    expect([
      theme["--radius-sm"],
      theme["--radius-md"],
      theme["--radius-lg"],
      theme["--radius-xl"],
    ]).toEqual(["6px", "8px", "12px", "12px"]);
  });

  test("superfícies em camadas: o fundo um tom abaixo dos painéis, nunca preto puro, borda com alfa", () => {
    const light = block(":root");
    const dark = block(".dark");
    expect(lightness(light["--background"])).toBeLessThan(lightness(light["--card"]));
    expect(lightness(light["--background"])).toBeGreaterThan(0.96);
    expect(lightness(dark["--background"])).toBeLessThan(lightness(dark["--card"]) - 0.02);
    // A deep gray: not pure black, not mid gray.
    expect(lightness(dark["--background"])).toBeGreaterThan(0.14);
    expect(lightness(dark["--background"])).toBeLessThan(0.22);
    expect(light["--border"]).toMatch(/\/\s*\d+%/);
    expect(dark["--border"]).toMatch(/\/\s*\d+%/);
  });

  test("uma cor de destaque só: o token brand alimenta o botão primário, o foco e o item ativo", () => {
    for (const theme of [block(":root"), block(".dark")]) {
      expect(theme["--brand"]).toMatch(/^oklch\(/);
      expect(theme["--primary"]).toBe("var(--brand)");
      expect(theme["--ring"]).toBe("var(--brand)");
      expect(theme["--sidebar-primary"]).toBe("var(--brand)");
    }
  });

  test("movimento de 120 a 180 ms com ease-out, e prefers-reduced-motion desliga", () => {
    const theme = block("@theme inline");
    expect(theme["--duration-fast"]).toBe("120ms");
    expect(theme["--duration-base"]).toBe("180ms");
    expect(theme["--ease-out-soft"]).toMatch(/^cubic-bezier\(/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration:\s*0\.01ms/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0\.01ms/s,
    );
  });

  test("o status é um pontinho de 8 px: azul com pulso, âmbar, cinza, esmaecido e vermelho", () => {
    const tones = ["running", "needs-you", "idle", "ended", "error"] as const;
    render(
      <div>
        {tones.map((tone) => (
          <StatusDot key={tone} tone={tone} label={`estado ${tone}`} />
        ))}
      </div>,
    );
    const dot = (tone: string) => screen.queryByRole("img", { name: `estado ${tone}` });
    for (const tone of tones) {
      expect(dot(tone)?.className ?? "").toContain("size-2");
      expect(dot(tone)?.className ?? "").toContain("rounded-full");
      expect(dot(tone)?.className ?? "").toContain(`bg-status-${tone}`);
      expect(dot(tone)?.getAttribute("title")).toBe(`estado ${tone}`);
    }
    // Only the running one pulses (and only when motion is allowed); the ended one fades.
    expect(dot("running")?.className ?? "").toContain("motion-safe:animate-pulse");
    for (const tone of ["needs-you", "idle", "ended", "error"]) {
      expect(dot(tone)?.className ?? "").not.toContain("animate-pulse");
    }
    expect(dot("ended")?.className ?? "").toContain("opacity-50");
    expect(dot("idle")?.className ?? "").not.toContain("opacity-50");
  });

  test("na lista, a linha tem o pontinho (sem pílula de estado) e a hora em números tabulares; só o rótulo é pílula", async () => {
    const d = makeDaemon(cleanups);
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Gerenciada" });
    await poll(() => d.manager.get(sessionId).status === "idle");
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => screen.queryByRole("listitem", { name: "Gerenciada" }) !== null);
    const row = screen.queryByRole("listitem", { name: "Gerenciada" }) as HTMLElement;
    const dot = within(row).queryByRole("img", { name: "ociosa" });
    expect(dot?.className ?? "").toContain("bg-status-idle");
    // No pill carries the state any more.
    expect(
      [...row.querySelectorAll("[data-slot='badge']")].some(
        (b) => (b.textContent ?? "") === "ociosa",
      ),
    ).toBe(false);
    const time = row.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.className ?? "").toContain("tabular-nums");
    expect(Number.isNaN(Date.parse(time?.getAttribute("datetime") ?? ""))).toBe(false);
  });
});
