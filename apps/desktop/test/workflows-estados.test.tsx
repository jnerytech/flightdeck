import { afterEach, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { WorkflowsPage } = await import("../src/ui/WorkflowsPage.tsx");

afterEach(cleanup);

// With no translator above it the page speaks pt-BR, the app's default language.

/** One state for every read: a new object each time would never settle. */
const NO_HOSTS = { hosts: [] };

/** A store that answers commands and knows no host (the templates dialog reads the hosts, #1221). */
const page = (hostCommand: () => Promise<unknown>) => {
  const store = { hostCommand, getState: () => NO_HOSTS, subscribe: () => () => {} };
  return <WorkflowsPage store={store as never} hostId="h1" projectId="p1" projectName="app" />;
};

test("while the host answers, the page says it is loading the workflows", async () => {
  await act(async () => {
    render(page(() => new Promise(() => {})));
  });
  expect(screen.queryByRole("status", { name: "Carregando workflows" })).not.toBeNull();
});

test("a project with no workflow says where they are read from, instead of a blank page", async () => {
  await act(async () => {
    render(page(async () => ({ workflows: [] })));
  });
  expect(screen.queryByText("Nenhum workflow na branch base ainda.")).not.toBeNull();
  expect(screen.queryByRole("status", { name: "Carregando workflows" })).toBeNull();
});

test("a workflow with no commands draws no empty list under its name", async () => {
  const workflow = { name: "feature", hash: "h", trusted: true, checks: [], errors: [] };
  await act(async () => {
    render(page(async () => ({ workflows: [workflow] })));
  });
  expect(screen.queryByRole("listitem", { name: "Workflow feature" })).not.toBeNull();
  // An empty <ul> has no list role for testing-library, so look it up by its label.
  expect(document.querySelector("[aria-label='Comandos de feature']") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
});

test("a host that does not answer leaves a message saying so, not an endless loading", async () => {
  await act(async () => {
    render(page(async () => null));
  });
  expect(
    screen.queryByText(
      "Não deu para ler os workflows. Veja se o host está conectado e abra a página de novo.",
    ),
  ).not.toBeNull();
  expect(screen.queryByRole("status", { name: "Carregando workflows" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
});
