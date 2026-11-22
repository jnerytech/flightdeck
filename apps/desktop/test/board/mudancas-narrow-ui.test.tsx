import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { settleMaybe } from "../wait.ts";
import {
  act,
  click,
  openChanges,
  openSession,
  runCleanups,
  screen,
  settle,
  setup,
} from "./mudancas-setup.tsx";

// Real git and a real watcher under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);

type Viewport = { setViewport(size: { width: number; height: number }): void };
const viewport = (width: number, height: number) =>
  (window as unknown as { happyDOM: Viewport }).happyDOM.setViewport({ width, height });

afterEach(async () => {
  viewport(1024, 768);
  await runCleanups();
});

const splitButton = () => screen.queryByRole("button", { name: "Lado a lado" });
const unifiedButton = () => screen.queryByRole("button", { name: "Unificada" });

describe("mudancas-narrow-ui (#4225, #4226)", () => {
  test("numa janela estreita o lado a lado fica desligado, diz por quê, e o diff segue unificado", async () => {
    viewport(390, 844);
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "README.md"), "# repo\nlinha DOIS\nlinha três\n");
    await openSession(ctx);
    await openChanges();
    await settle(() => screen.queryByRole("region", { name: "Diff unificado" }) !== null);

    expect(splitButton()?.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Lado a lado precisa de uma janela mais larga.")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Diff lado a lado" })).toBeNull();
    expect(unifiedButton()?.getAttribute("aria-pressed")).toBe("true");

    // The window grows: the choice comes back, and the reason goes.
    await act(async () => viewport(1024, 768));
    await settle(() => window.matchMedia("(width < 640px)").matches === false);
    await act(async () => {});
    // happy-dom only fires a media query's change event when it starts matching, never when it stops
    // (its listener starts from "no match"), so a refresh makes the panel read the width again.
    await click("Atualizar");
    expect(await settleMaybe(() => splitButton()?.hasAttribute("disabled") === false)).toBe(true);
    expect(screen.queryByText("Lado a lado precisa de uma janela mais larga.")).toBeNull();
    await click("Lado a lado");
    expect(screen.queryByRole("region", { name: "Diff lado a lado" })).not.toBeNull();
  });

  test("o lado a lado tem títulos para os dois lados, diz adicionada e removida e o botão ligado tem um sinal além da cor", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "README.md"), "# repo\nlinha DOIS\nlinha três\n");
    await openSession(ctx);
    await openChanges();
    await settle(() => screen.queryByRole("region", { name: "Diff unificado" }) !== null);
    await click("Lado a lado");

    const region = screen.queryByRole("region", { name: "Diff lado a lado" });
    const headings = Array.from(region?.querySelectorAll("th") ?? []).map((th) => th.textContent);
    expect(headings.slice(0, 2)).toEqual(["Antes", "Depois"]);
    const cells = Array.from(region?.querySelectorAll("td") ?? []).map(
      (td) => td.textContent ?? "",
    );
    expect(cells.some((cell) => cell.includes("Removida") && cell.includes("linha dois"))).toBe(
      true,
    );
    expect(cells.some((cell) => cell.includes("Adicionada") && cell.includes("linha DOIS"))).toBe(
      true,
    );
    // An unchanged line says neither.
    expect(
      cells
        .filter((cell) => cell.includes("linha três"))
        .every((cell) => !/Removida|Adicionada/.test(cell)),
    ).toBe(true);

    // The pressed toggle shows a check mark, not only a tint; the other one has none.
    expect(splitButton()?.querySelector("svg") !== null).toBe(true);
    expect(unifiedButton()?.querySelector("svg") === null).toBe(true);
    // A picked line number has a cue beyond its colour.
    const number = screen.queryAllByRole("button", { name: /^Comentar a linha/ })[0];
    expect(number?.className.includes("aria-pressed:underline")).toBe(true);
  });
});
