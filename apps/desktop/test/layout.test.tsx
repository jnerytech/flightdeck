import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppShell } = await import("../src/components/layout/app-shell.tsx");
const { Page, Section } = await import("../src/components/layout/page.tsx");
const { Grid, Inline, Stack, Toolbar } = await import("../src/components/layout/stack.tsx");
const { EmptyState, ErrorState, LoadingState } = await import(
  "../src/components/layout/states.tsx"
);

/** happy-dom evaluates media queries against its viewport and fires `change` on resize. */
async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
    await Bun.sleep(5);
  });
}

afterEach(async () => {
  cleanup();
  await viewport(1024);
});

const LABELS = {
  sidebar: "Barra lateral",
  collapse: "Recolher barra lateral",
  expand: "Mostrar barra lateral",
};

function shell() {
  render(
    <AppShell
      header={<span>Flightdeck</span>}
      sidebar={(collapsed: boolean) => <p>{collapsed ? "ícones" : "hosts"}</p>}
      labels={LABELS}
    >
      <p>conteúdo</p>
    </AppShell>,
  );
}

const sidebar = () => screen.queryByRole("complementary", { name: "Barra lateral" });
const toggle = () =>
  screen.queryByRole("button", { name: "Recolher barra lateral" }) ??
  screen.queryByRole("button", { name: "Mostrar barra lateral" });

describe("layout", () => {
  test("AppShell: cabeçalho fixo, barra de 240 px que recolhe para 56 px só com ícones, e conteúdo", async () => {
    shell();
    expect(screen.queryByRole("banner")?.textContent ?? "").toContain("Flightdeck");
    expect(screen.queryByRole("main")?.textContent).toBe("conteúdo");
    expect(sidebar()?.textContent).toBe("hosts");
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("false");
    expect(sidebar()?.parentElement?.className ?? "").toContain("grid-cols-[240px_minmax(0,1fr)]");
    expect(toggle()?.getAttribute("aria-label")).toBe("Recolher barra lateral");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    // The rail stays: only the icons.
    expect(sidebar()?.textContent).toBe("ícones");
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("true");
    expect(sidebar()?.parentElement?.className ?? "").toContain("grid-cols-[56px_minmax(0,1fr)]");
    expect(toggle()?.getAttribute("aria-label")).toBe("Mostrar barra lateral");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    expect(sidebar()?.textContent).toBe("hosts");
  });

  test("abaixo de 960 px a barra vira trilho sozinha e volta ao alargar", async () => {
    shell();
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("false");
    await viewport(800);
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("true");
    // Still expandable by hand in a narrow window.
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("false");
    await viewport(1200);
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("false");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  });

  test("Page: título, subtítulo, ações e barra de ferramentas fora da rolagem; o corpo rola", () => {
    render(
      <Page
        title="Sessões"
        subtitle="3 hosts"
        actions={<button type="button">Nova sessão</button>}
        toolbar={
          <Toolbar label="Filtros">
            <input aria-label="Filtrar" />
          </Toolbar>
        }
      >
        <ul>
          {Array.from({ length: 80 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
            <li key={i}>{`sessão ${i}`}</li>
          ))}
        </ul>
      </Page>,
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Sessões" })).not.toBeNull();
    expect(screen.queryByText("3 hosts")).not.toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Filtros" })).not.toBeNull();
    const viewport = document.querySelector("[data-slot='scroll-area-viewport']");
    expect(viewport).not.toBeNull();
    expect(viewport?.textContent ?? "").toContain("sessão 79");
    // The header and the toolbar stay put: they are outside the scrolling viewport.
    expect(viewport?.textContent ?? "").not.toContain("Sessões");
    expect(viewport?.querySelector("[role='toolbar']") ?? null).toBeNull();
    expect(viewport?.textContent ?? "").not.toContain("Nova sessão");
  });

  test("Section, Grid por colunas e Stack/Inline com a escala", () => {
    render(
      <Stack gap={6}>
        <Section title="Hosts" actions={<button type="button">Adicionar</button>}>
          <Grid cols={{ base: 1, md: 2, xl: 3 }} gap={4}>
            <div>a</div>
          </Grid>
        </Section>
        <Inline gap={2}>
          <span>b</span>
        </Inline>
      </Stack>,
    );
    expect(screen.queryByRole("region", { name: "Hosts" })).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Hosts" })).not.toBeNull();
    const grid = screen.queryByText("a")?.parentElement;
    expect(grid?.className.split(" ").sort()).toEqual(
      ["gap-4", "grid", "grid-cols-1", "md:grid-cols-2", "xl:grid-cols-3"].sort(),
    );
    const inline = screen.queryByText("b")?.parentElement;
    expect(inline?.className.split(" ").sort()).toEqual(
      ["flex", "flex-row", "flex-wrap", "gap-2", "items-center"].sort(),
    );
    const stack = inline?.parentElement;
    expect(stack?.className.split(" ").sort()).toEqual(["flex", "flex-col", "gap-6"].sort());
  });

  test("os três estados padrão: vazio com ação, carregando e erro com tentar de novo", async () => {
    let retried = 0;
    render(
      <>
        <EmptyState title="Nenhum card" action={<button type="button">Criar card</button>} />
        <LoadingState label="Carregando sessões" />
        <ErrorState message="host offline" retryLabel="Tentar de novo" onRetry={() => retried++} />
      </>,
    );
    expect(screen.queryByText("Nenhum card")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Criar card" })).not.toBeNull();
    const loading = screen.queryByRole("status", { name: "Carregando sessões" });
    expect(loading?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("host offline");
    const retry = screen.queryByRole("button", { name: "Tentar de novo" });
    expect(retry).not.toBeNull();
    await act(async () => {
      fireEvent.click(retry as HTMLElement);
    });
    expect(retried).toBe(1);
  });
});
