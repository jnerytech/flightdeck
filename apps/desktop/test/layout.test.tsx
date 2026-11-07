import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

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

const settle = waiter(4000);

/** happy-dom evaluates media queries against its viewport and fires `change` on resize. */
async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  // The change event reaches the shell on happy-dom's own timer: wait for the query to say so and for
  // React to flush, not for a fixed few milliseconds, which a loaded suite outlasts.
  await settle(() => window.matchMedia("(width < 1024px)").matches === width < 1024);
  await settle(() => window.matchMedia("(width < 640px)").matches === width < 640);
  await act(async () => {});
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
  test("AppShell: a barra de status vai em uma terceira linha, depois do conteúdo e sem tirar a largura dele", () => {
    render(
      <AppShell
        header={<span>Flightdeck</span>}
        status={<p>barra</p>}
        sidebar={() => <p>hosts</p>}
        labels={LABELS}
      >
        <p>conteúdo</p>
      </AppShell>,
    );
    const bar = screen.getByText("barra");
    const status = bar.closest("[data-slot='shell-status']") as HTMLElement;
    const main = screen.getByRole("main");
    // Last in the frame, after the sidebar-and-content row, which keeps its own columns.
    expect(status.parentElement?.lastElementChild).toBe(status);
    expect(main.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.parentElement?.className ?? "").toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    // A window under 600 px tall has no height to spare (the 720x480 floors of #422 and #437): the
    // wrapper carries the class that hides it there.
    expect(status.className).toContain("shell-status");
    cleanup();
    shell();
    expect(document.querySelector("[data-slot='shell-status']")).toBeNull();
  });

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

  test("medium (640 to 1023 px): the rail stays, and the toggle opens the full sidebar as an overlay that Esc closes", async () => {
    shell();
    await viewport(800);
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("true");
    expect(sidebar()?.textContent).toBe("ícones");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    const overlay = screen.queryByRole("dialog", { name: "Barra lateral" });
    expect(overlay?.textContent ?? "").toContain("hosts");
    // The overlay does not push: the rail keeps its 56 px column and the content its place.
    expect(
      document.querySelector("[data-slot='sidebar']")?.parentElement?.className ?? "",
    ).toContain("grid-cols-[56px_minmax(0,1fr)]");
    await act(async () => {
      fireEvent.keyDown(overlay as HTMLElement, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Barra lateral" }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    expect(screen.queryByRole("dialog", { name: "Barra lateral" })).not.toBeNull();
    // Widening to 1024 px closes it and the sidebar pushes the content again.
    await viewport(1200);
    expect(screen.queryByRole("dialog", { name: "Barra lateral" }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(sidebar()?.getAttribute("data-collapsed")).toBe("false");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  });

  test("compact (below 640 px): no rail, a menu button opens the sidebar as a drawer, Esc returns the focus to it", async () => {
    shell();
    await viewport(500);
    expect(sidebar() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(screen.queryByRole("main")?.textContent).toBe("conteúdo");
    const menu = toggle() as HTMLElement;
    expect(menu.getAttribute("aria-label")).toBe("Mostrar barra lateral");
    await act(async () => {
      menu.focus();
      fireEvent.click(menu);
    });
    const drawer = screen.queryByRole("dialog", { name: "Barra lateral" });
    expect(drawer?.textContent ?? "").toContain("hosts");
    expect(drawer?.className ?? "").toContain("w-[min(320px,85vw)]");
    await act(async () => {
      fireEvent.keyDown(drawer as HTMLElement, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Barra lateral" }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => document.activeElement === toggle());
    expect(document.activeElement === toggle()).toBe(true); // NOSONAR: toBe would print both DOM nodes on failure
  });

  test("the drawer has its own close button, and it closes after navigating (a new navKey)", async () => {
    const view = (key: string) => (
      <AppShell
        header={<span>Flightdeck</span>}
        sidebar={() => <p>hosts</p>}
        labels={LABELS}
        navKey={key}
      >
        <p>conteúdo</p>
      </AppShell>
    );
    const { rerender } = render(view("a"));
    await viewport(500);
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    expect(screen.queryByRole("dialog", { name: "Barra lateral" })).not.toBeNull();
    rerender(view("a"));
    expect(screen.queryByRole("dialog", { name: "Barra lateral" })).not.toBeNull();
    rerender(view("b"));
    await settle(() => screen.queryByRole("dialog", { name: "Barra lateral" }) === null);
    expect(screen.queryByRole("dialog", { name: "Barra lateral" }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    const close = screen.queryByRole("button", { name: "Recolher barra lateral" });
    expect(close).not.toBeNull();
    await act(async () => {
      if (close) fireEvent.click(close);
    });
    expect(screen.queryByRole("dialog", { name: "Barra lateral" }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
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

  test("Page: the blocks of the body sit 24 px apart, so a card never touches the one above (#588)", () => {
    render(
      <Page title="Projeto">
        <div data-testid="links">links</div>
        <div data-testid="config">config</div>
      </Page>,
    );
    const body = screen.queryByTestId("links")?.parentElement;
    expect(body?.className.split(" ") ?? []).toEqual(
      expect.arrayContaining(["flex", "flex-col", "gap-6"]),
    );
  });

  test("Page: the body is named page-body, scrolling or filling, so the spacing guard finds its blocks (#588)", () => {
    render(
      <Page title="Projeto">
        <div data-testid="scrolls">a</div>
      </Page>,
    );
    expect(screen.queryByTestId("scrolls")?.parentElement?.getAttribute("data-slot")).toBe(
      "page-body",
    );
    cleanup();
    render(
      <Page title="Terminal" fill>
        <div data-testid="fills">b</div>
      </Page>,
    );
    expect(screen.queryByTestId("fills")?.parentElement?.getAttribute("data-slot")).toBe(
      "page-body",
    );
  });

  test("Page: the header and the title are named page-header and page-title, for the narrow-window guard (#641)", () => {
    render(<Page title="Projeto">body</Page>);
    const title = screen.getByRole("heading", { name: "Projeto" });
    expect(title.getAttribute("data-slot")).toBe("page-title");
    expect(title.closest("[data-slot='page-header']")).not.toBeNull();
  });

  test("Page: the body positions what it holds, so an sr-only caption scrolls inside it and cannot stretch the screen (#640)", () => {
    render(
      <Page title="Host">
        <div data-testid="table">table</div>
      </Page>,
    );
    const body = screen.queryByTestId("table")?.parentElement;
    expect(body?.className.split(" ").includes("relative") ?? false).toBe(true);
  });

  test("Page: the side gutter is 12 px, 16 px from a 640 px area and 24 px from a 1024 px one (its area, not the window: a split pane is narrow), in the header and both bodies (#641)", () => {
    const gutters = (el: Element | null | undefined) =>
      ["px-3", "@min-[40rem]:px-4", "@min-[64rem]:px-6", "px-6"].filter((c) =>
        (el?.className.split(" ") ?? []).includes(c),
      );
    render(
      <Page title="Scrolls" toolbar={<span data-testid="tools">tools</span>}>
        <div data-testid="scrolling">body</div>
      </Page>,
    );
    expect(gutters(screen.queryByTestId("tools")?.parentElement)).toEqual([
      "px-3",
      "@min-[40rem]:px-4",
      "@min-[64rem]:px-6",
    ]);
    expect(gutters(screen.queryByTestId("scrolling")?.parentElement)).toEqual([
      "px-3",
      "@min-[40rem]:px-4",
      "@min-[64rem]:px-6",
    ]);
    cleanup();
    render(
      <Page title="Fills" fill>
        <div data-testid="filling">body</div>
      </Page>,
    );
    expect(gutters(screen.queryByTestId("filling")?.parentElement)).toEqual([
      "px-3",
      "@min-[40rem]:px-4",
      "@min-[64rem]:px-6",
    ]);
  });

  test("Page: a long title wraps to two lines, then truncates, and keeps its full text in title (#641)", () => {
    render(<Page title="Board of a project with a very long name indeed">body</Page>);
    const h1 = screen.queryByRole("heading", { level: 1 });
    const classes = h1?.className.split(" ") ?? [];
    expect(classes.includes("line-clamp-2")).toBe(true);
    expect(classes.includes("truncate")).toBe(false);
    expect(h1?.getAttribute("title")).toBe("Board of a project with a very long name indeed");
  });

  test("Page fill: o corpo é uma coluna flex que ocupa o resto da altura, sem a área de rolagem", () => {
    render(
      <Page title="Terminal" fill>
        <div data-testid="filho">conteúdo</div>
      </Page>,
    );
    const body = screen.queryByTestId("filho")?.parentElement;
    expect(body?.className).toContain("flex-col");
    expect(body?.className).toContain("flex-1");
    expect(document.querySelector("[data-slot='scroll-area-viewport']")).toBeNull();
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
      ["@3xl:grid-cols-2", "@7xl:grid-cols-3", "gap-4", "grid", "grid-cols-1"].sort(),
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
