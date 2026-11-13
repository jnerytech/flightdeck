import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionButton } = await import("../../src/shared/feedback/index.ts");
const { FieldRow } = await import("../../src/shared/layout/form.tsx");
const { AllowedFolders } = await import("../../src/features/hosts/allowed-folders.tsx");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { Dialog, DialogContent, DialogFooter, DialogTitle } = await import(
  "../../src/components/ui/dialog.tsx"
);

afterEach(cleanup);

const css = readStyles(join(import.meta.dir, "../../src/styles.css"));

describe("botao-motivo-linha: a button's reason does not make its row taller", () => {
  test("the reason hangs under the button out of the layout, and the button is still described by it", () => {
    render(
      <div data-testid="row">
        <input aria-label="pasta" />
        <ActionButton disabled disabledReason="Digite a pasta.">
          Adicionar
        </ActionButton>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Adicionar" });
    const reason = screen.getByText("Digite a pasta.");
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    // The reason lives in a box with the button, taking no height of its own.
    expect(reason.className).toContain("action-reason");
    expect(button.parentElement).toBe(reason.parentElement);
    expect(button.parentElement?.className).toContain("action-button-box");
    expect(css).toMatch(/@utility action-reason \{[^}]*position: absolute/);
    expect(css).toMatch(/@utility action-button-box \{[^}]*position: relative/);
  });

  test("without a reason the button has no box around it", () => {
    render(<ActionButton>Ir</ActionButton>);
    const button = screen.getByRole("button", { name: "Ir" });
    expect(button.parentElement?.className ?? "").not.toContain("action-button-box");
  });
});

describe("botao-motivo-linha: a button in a form row", () => {
  const row = (disabled: boolean) => (
    <FieldRow>
      <input aria-label="pasta" />
      <ActionButton disabled={disabled} disabledReason="Digite a pasta.">
        Adicionar
      </ActionButton>
    </FieldRow>
  );

  test("the reason is the row's help line, under the input's edge and not under the button", () => {
    render(row(true));
    const button = screen.getByRole("button", { name: "Adicionar" });
    const help = screen.getByText("Digite a pasta.");
    expect(help.className).toContain("field-help");
    expect(button.getAttribute("aria-describedby")).toBe(help.id);
    // The button has no box of its own, and the help follows the row it belongs to.
    expect(button.parentElement?.className ?? "").not.toContain("action-button-box");
    const rowBox = screen.getByRole("textbox", { name: "pasta" }).parentElement as HTMLElement;
    expect(rowBox.className).toContain("field-row");
    expect(rowBox.nextElementSibling).toBe(help);
    expect(css).toMatch(/@utility field-help \{/);
  });

  // #732: the row kept one reason, so two disabled buttons shared it (the last one won) and the
  // card's Run row fell back to reasons that hung under each button and printed over each other.
  test("two disabled buttons each say why on a line of their own, and enabling one drops only its line", () => {
    const pair = (stopOff: boolean) => (
      <FieldRow>
        <ActionButton disabled={stopOff} disabledReason="Não está rodando.">
          Parar
        </ActionButton>
        <ActionButton disabled disabledReason="Inicie antes do PR.">
          Abrir PR
        </ActionButton>
      </FieldRow>
    );
    const { rerender } = render(pair(true));
    const describedBy = (name: string) =>
      document.getElementById(
        screen.queryByRole("button", { name })?.getAttribute("aria-describedby") ?? "",
      )?.textContent ?? null;
    const lines = () =>
      [...document.querySelectorAll(".field-help")].map((line) => line.textContent ?? "");
    const both = { stop: describedBy("Parar"), pr: describedBy("Abrir PR"), lines: lines() };
    rerender(pair(false));
    const one = { stop: describedBy("Parar"), pr: describedBy("Abrir PR"), lines: lines() };
    expect({ both, one }).toEqual({
      both: {
        stop: "Não está rodando.",
        pr: "Inicie antes do PR.",
        lines: ["Não está rodando.", "Inicie antes do PR."],
      },
      one: { stop: null, pr: "Inicie antes do PR.", lines: ["Inicie antes do PR."] },
    });
  });

  // #732: Open PR stays off while its reason changes ("start the card first", then "a PR is
  // already open"): its own line says the new reason, in the same place.
  test("a disabled button whose reason changes says the new one on its own line", () => {
    const one = (reason: string) => (
      <FieldRow>
        <ActionButton disabled disabledReason={reason}>
          Abrir PR
        </ActionButton>
      </FieldRow>
    );
    const { rerender } = render(one("Inicie antes do PR."));
    rerender(one("O PR já está aberto."));
    const lines = [...document.querySelectorAll(".field-help")].map((line) => line.textContent);
    const described = document.getElementById(
      screen.queryByRole("button", { name: "Abrir PR" })?.getAttribute("aria-describedby") ?? "",
    )?.textContent;
    expect({ lines, described }).toEqual({
      lines: ["O PR já está aberto."],
      described: "O PR já está aberto.",
    });
  });

  test("the help is gone once the button is enabled", () => {
    const { rerender } = render(row(true));
    expect(screen.queryByText("Digite a pasta.")).not.toBeNull();
    rerender(row(false));
    expect(screen.queryByText("Digite a pasta.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Adicionar" }).getAttribute("aria-describedby"),
    ).toBeNull();
  });
});

describe("botao-motivo-linha: allowed folders", () => {
  const setup = (pick?: () => Promise<string | null>, url = "ws://127.0.0.1:1/v1/ws") => {
    const platform = memoryPlatform(false, "pt-BR").platform;
    if (pick) platform.pickFolder = pick;
    const store = new AppStore(platform, { baseDelayMs: 600_000 });
    const host = { id: "h", name: "alfa", url, status: "online", sessions: [] } as never;
    render(<AllowedFolders store={store} host={host} />);
    return store;
  };

  test("its reason is the help line of the row, under the input", () => {
    setup();
    const input = screen.getByRole("textbox", { name: "Pasta a permitir" });
    const help = screen.getByText("Digite a pasta a permitir.");
    expect(help.className).toContain("field-help");
    expect((input.parentElement as HTMLElement).nextElementSibling).toBe(help);
  });

  test("the box says what a folder looks like", () => {
    setup();
    const input = screen.getByRole("textbox", { name: "Pasta a permitir" }) as HTMLInputElement;
    expect(input.placeholder).toBe("D:\\repos\\...");
  });

  test("Escolher pasta… fills the box with the folder the system dialog gives", async () => {
    setup(async () => "D:\\repos\\api");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Escolher pasta…" }));
    });
    expect(
      (screen.getByRole("textbox", { name: "Pasta a permitir" }) as HTMLInputElement).value,
    ).toBe("D:\\repos\\api");
  });

  test("a cancelled dialog leaves the box alone, and without a dialog or for a remote host there is no button", async () => {
    setup(async () => null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Escolher pasta…" }));
    });
    expect(
      (screen.getByRole("textbox", { name: "Pasta a permitir" }) as HTMLInputElement).value,
    ).toBe("");
    cleanup();
    setup();
    expect(screen.queryByRole("button", { name: "Escolher pasta…" })).toBeNull();
    cleanup();
    setup(async () => "x", "ws://10.0.0.5:7000/v1/ws");
    expect(screen.queryByRole("button", { name: "Escolher pasta…" })).toBeNull();
  });
});

// #1063: a dialog's footer puts its last button at the dialog's right edge. Its reason hung from the
// button's left and grew right, so Add project's "Pick or type a folder." was cut by the dialog at
// 1280. In a footer the reason hangs from the button's right and grows left, inside the dialog.
// happy-dom has no layout: this reads the rule, and the projetos-novo print shows the fit.
describe("botao-motivo-linha: in a dialog's footer the reason grows inward (#1063)", () => {
  // Only the footer's last button is at the dialog's right edge. A button first in the row (the
  // snippet dialog's Run, with no terminal) is at its left edge: hung from its right, its reason
  // would grow past the left edge instead, so it keeps hanging from its left.
  const RULE =
    /\[data-slot="dialog-footer"\] > \.action-button-box:last-child \.action-reason \{([^}]*)\}/;

  test("the reason of a footer's last button hangs from its right; a button before it keeps the left", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add project</DialogTitle>
          <DialogFooter>
            <ActionButton disabled disabledReason="Run needs a folder.">
              Run
            </ActionButton>
            <ActionButton disabled disabledReason="Pick or type a folder.">
              Add
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const footer = document.querySelector('[data-slot="dialog-footer"]');
    const box = (text: string) => screen.queryByText(text)?.parentElement ?? null;
    const rule = css.match(RULE)?.[1] ?? "";
    expect([
      box("Pick or type a folder.") === footer?.lastElementChild,
      box("Run needs a folder.") === footer?.firstElementChild,
      /right: 0;/.test(rule),
      /left: auto;/.test(rule),
      /text-align: right;/.test(rule),
      css.includes('[data-slot="dialog-footer"] .action-reason {'),
    ]).toEqual([true, true, true, true, true, false]);
  });
});

// #1270, #1325: a field with its action (a card's Save spec file, Send adjustment) puts the button
// at the row's right end, at the card's edge. Hung out of the flow (#38), its reason first ran past
// the card (#1270), then, hung from the row's right, drew over the line under the row: a wrapped
// pt-BR reason covered "No spec file at …" and Check again (#1325). Beside a field the reason is now
// a line of the row itself: the row wraps, the button's box gives way (display: contents), and the
// reason takes a whole line under the field and the buttons, so it pushes what follows down.
// #1326: at 390 the field got less width than its button; below 40rem it takes a line of its own
// and the buttons go under it, at the end. happy-dom has no layout: this reads the rules; the narrow
// guard measures them (reason-over, and card-gate in the narrow prints).
describe("botao-motivo-linha: beside a field the reason is a line of the row (#1270, #1325, #1326)", () => {
  // Inside the field-with-action utility: the stylesheet keeps no class selectors of its own (base-ui).
  const utility = () => {
    const at = css.indexOf("@utility field-with-action {");
    return at < 0 ? "" : css.slice(at, css.indexOf("\n}\n", at));
  };
  const REASON = /& > \.action-button-box > \.action-reason \{([^}]*)\}/;
  const BOX = /& > \.action-button-box \{([^}]*)\}/;
  const ROW = /@utility field-with-action \{([^&@]*)/;
  /** The body of the block that opens at `head` inside the utility, read by brace depth. */
  const block = (head: string) => {
    const text = utility();
    const start = text.indexOf(head);
    if (start < 0) return "";
    const open = text.indexOf("{", start);
    let depth = 0;
    for (let at = open; at < text.length; at++) {
      if (text[at] === "{") depth++;
      else if (text[at] === "}" && --depth === 0) return text.slice(open + 1, at);
    }
    return "";
  };

  test("the reason of a field's action button is a whole line of the row, under the field and the buttons", () => {
    const { container } = render(
      <div className="field-with-action">
        <input aria-label="Spec file" />
        <ActionButton disabled disabledReason="Type the spec file's path to save it.">
          Save spec file
        </ActionButton>
      </div>,
    );
    const row = container.querySelector(".field-with-action");
    const box = screen.queryByText("Type the spec file's path to save it.")?.parentElement ?? null;
    const reason = utility().match(REASON)?.[1] ?? "";
    const own = utility().match(BOX)?.[1] ?? "";
    const outer = utility().match(ROW)?.[1] ?? "";
    expect([
      box?.parentElement === row,
      /flex-wrap: wrap;/.test(outer),
      /display: contents;/.test(own),
      /position: static;/.test(reason),
      /order: 1;/.test(reason),
      /flex-basis: 100%;/.test(reason),
      /width: auto;/.test(reason),
      /max-width: none;/.test(reason),
    ]).toEqual([true, true, true, true, true, true, true, true]);
  });

  // #1338's review: the row wraps now, so a field that cannot shrink below its content (the
  // adjustment's, with no min-w-0) would push its button to a line of its own at any width.
  test("the field shrinks before the row wraps: its buttons stay beside it above 40rem", () => {
    const field = block("& > :first-child");
    expect([/min-width: 0;/.test(field), /flex: 1 1 0%;/.test(field)]).toEqual([true, true]);
  });

  test("below 40rem the field takes a line of its own and its buttons go under it, at the end", () => {
    const narrow = block("@media (width < 40rem)");
    expect([
      /justify-content: flex-end;/.test(narrow),
      /& > :first-child \{\s*flex-basis: 100%;/.test(narrow),
    ]).toEqual([true, true]);
  });
});
