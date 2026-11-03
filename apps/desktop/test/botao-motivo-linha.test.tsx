import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionButton } = await import("../src/components/feedback/action-button.tsx");
const { FieldRow } = await import("../src/components/layout/form.tsx");
const { AllowedFolders } = await import("../src/components/hosts/allowed-folders.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

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
