import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Field, Form, FormActions } = await import("../src/components/layout/form.tsx");

afterEach(cleanup);

const formOf = (container: HTMLElement) => container.querySelector("form");

describe("form-layout: Form", () => {
  test("is a real form: submitting runs onSubmit once and the page does not navigate", () => {
    let submitted = 0;
    const { container } = render(
      <Form onSubmit={() => submitted++}>
        <input aria-label="nome" />
        <FormActions submit="Salvar" />
      </Form>,
    );
    const form = formOf(container);
    expect(form).not.toBeNull();
    const notPrevented = fireEvent.submit(form as HTMLFormElement);
    expect(submitted).toBe(1);
    expect(notPrevented).toBe(false);
  });

  test("the primary button is the only submit button, and Cancelar never submits (so Enter cannot trigger it)", () => {
    const { container } = render(
      <Form onSubmit={() => {}}>
        <textarea aria-label="texto" />
        <FormActions submit="Criar" cancel="Cancelar" onCancel={() => {}} />
      </Form>,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => [b.textContent, b.type])).toEqual([
      ["Cancelar", "button"],
      ["Criar", "submit"],
    ]);
    // A textarea stays a textarea: Enter in it adds a line, only inputs submit with Enter.
    expect(container.querySelector("form textarea")).not.toBeNull();
  });

  test("the layout follows where the form lives: a page is as wide as a reading column, a dialog fills its body", () => {
    const page = render(
      <Form onSubmit={() => {}} variant="page">
        <FormActions submit="Ok" />
      </Form>,
    );
    expect(formOf(page.container)?.getAttribute("data-variant")).toBe("page");
    expect(formOf(page.container)?.className).toContain("max-w-xl");
    cleanup();
    const dialog = render(
      <Form onSubmit={() => {}} variant="dialog">
        <FormActions submit="Ok" />
      </Form>,
    );
    expect(formOf(dialog.container)?.getAttribute("data-variant")).toBe("dialog");
    expect(formOf(dialog.container)?.className).not.toContain("max-w-xl");
  });

  test("the buttons sit at the end of a dialog and at the left edge of the fields on a page, primary last in both", () => {
    const row = (variant: "page" | "dialog" | "panel") => {
      const { container } = render(
        <Form onSubmit={() => {}} variant={variant}>
          <FormActions submit="Salvar" cancel="Cancelar" onCancel={() => {}} />
        </Form>,
      );
      const actions = container.querySelector("[data-actions]");
      expect(actions).not.toBeNull();
      const labels = [...(actions?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
      const className = actions?.className ?? "";
      cleanup();
      return { className, labels };
    };
    expect(row("dialog").className).toContain("justify-end");
    expect(row("page").className).toContain("justify-start");
    expect(row("panel").className).toContain("justify-start");
    for (const variant of ["page", "dialog", "panel"] as const) {
      expect(row(variant).labels).toEqual(["Cancelar", "Salvar"]);
    }
  });
});

describe("form-layout: Field", () => {
  test("the label is above its control and bound to it by id", () => {
    render(
      <Form onSubmit={() => {}}>
        <Field label="Nome">{(control) => <input {...control} />}</Field>
        <Field label="Descrição">{(control) => <input {...control} />}</Field>
      </Form>,
    );
    const nome = screen.queryByLabelText("Nome") as HTMLInputElement | null;
    const descricao = screen.queryByLabelText("Descrição") as HTMLInputElement | null;
    expect(nome).not.toBeNull();
    expect(descricao).not.toBeNull();
    expect(nome?.id).not.toBe("");
    expect(nome?.id).not.toBe(descricao?.id);
    const label = screen.queryByText("Nome");
    expect(label?.tagName).toBe("LABEL");
    // Label first, control after it: labels above fields, never beside them.
    expect(
      (label?.compareDocumentPosition(nome as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("help text is read with the control, and an error is an alert that marks the control invalid", () => {
    render(
      <Form onSubmit={() => {}}>
        <Field label="Porta" help="Entre 1 e 65535" error="Porta fora da faixa">
          {(control) => <input {...control} />}
        </Field>
        <Field label="Host">{(control) => <input {...control} />}</Field>
      </Form>,
    );
    const porta = screen.queryByLabelText("Porta") as HTMLInputElement;
    const help = screen.queryByText("Entre 1 e 65535");
    const error = screen.queryByRole("alert");
    expect(help).not.toBeNull();
    expect(error?.textContent).toBe("Porta fora da faixa");
    const described = (porta.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toContain(help?.id ?? "?");
    expect(described).toContain(error?.id ?? "?");
    expect(porta.getAttribute("aria-invalid")).toBe("true");
    const host = screen.queryByLabelText("Host") as HTMLInputElement;
    expect(host.getAttribute("aria-invalid")).toBeNull();
    expect(host.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("form-layout: a disabled primary button says why", () => {
  test("the reason shows under the buttons and is linked to the button; it goes away when the form is ready", () => {
    const view = render(
      <Form onSubmit={() => {}}>
        <FormActions submit="Criar" disabled disabledReason="Escolha um nome primeiro" />
      </Form>,
    );
    const button = screen.queryByRole("button", { name: "Criar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reason = screen.queryByText("Escolha um nome primeiro");
    expect(reason).not.toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
    view.rerender(
      <Form onSubmit={() => {}}>
        <FormActions submit="Criar" disabledReason="Escolha um nome primeiro" />
      </Form>,
    );
    expect(screen.queryByText("Escolha um nome primeiro")).toBeNull();
    expect((screen.queryByRole("button", { name: "Criar" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
